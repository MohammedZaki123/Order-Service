import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {ICacheProvider} from "../../../pkg/cache/cache.interface";
import {Server as IoServer} from "socket.io";
import {container} from "../../../lib/di/container";
import {IPaymentProvider, KashierWebhookEnvelope} from "../../../pkg/payments/types";
import {db} from "../../../lib/knex/knex";
import {AppError} from "../../../lib/error/AppError";
import {logger} from "../../../lib/logger/logger";
import * as orderRepo from "../../order/repository/order.repo";
import * as providerRepo from "../repository/payment-provider.repo";
import * as sessionRepo from "../repository/payment-session.repo";
import * as transactionRepo from "../repository/transaction.repo";
import * as webhookRepo from "../repository/payment-webhook-event.repo";
import {TransactionEntity} from "../entity/transaction.entity";
import {PaymentWebhookEventEntity} from "../entity/payment-webhook-event.entity";
import {OrderStatus} from "../../order/enums";
import {
    PAYMENT_PROVIDER_IDS,
    PaymentSessionStatus,
    TransactionMethod,
    TransactionStatus,
    TransactionType,
    PaymentProviderName
} from "../enums";
import {getBranch} from "../../../lib/core-client/branch.client";
import {InvalidWebhookSignatureError, MalformedWebhookError} from "../errors";
import {insertOutboxEvent} from "../../../lib/events/outbox.repo";
import {EVENT_TYPES} from "../../../lib/events/event-types";
import * as itemRepo from "../../order/repository/order-item.repo";
import {OrderSummaryResponseDTO, OrderStatusResponseDTO} from "../../order/dto/order.response.dto";

const RESTAURANT_ORDERS_CACHE_PREFIX = (region: string, branchId: number) => `${region}:GET:/api/restaurant/orders?branchId=${branchId}`;

const KASHIER_PROVIDER_ID = PAYMENT_PROVIDER_IDS[PaymentProviderName.KASHIER];


@injectable()
export class PaymentWebhookService {
    constructor(
        @inject(TOKENS.KashierProvider) private readonly paymentProvider: IPaymentProvider,
        @inject(TOKENS.CacheProvider) private readonly cacheProvider: ICacheProvider,
        // @inject(TOKENS.WsServer) private readonly io: Server
    ) {}

    private get io(): IoServer {
        return container.resolve<IoServer>(TOKENS.WsServer);
    }

    async verifyAndProcessWebhook(
        rawBody: Buffer,
        signature: string,
        region: string
    ): Promise<void> {

        const envelope = parseEnvelope(rawBody);
        if (envelope.event !== "pay") {
            logger.info(`[PaymentWebhook] Kashier webhook event ignored: ${envelope.event}`);
            return;
        }
        if(!signature) throw InvalidWebhookSignatureError;
        // 1. Verify provider is active
        const kashierProvider = await providerRepo.findProviderByName("kashier", db(region));
        if (!kashierProvider || !kashierProvider.isEnabled) {
            throw new AppError("Kashier provider not active or configured", 400);
        }

        // 2. Verify signature — pass signatureKeys optionally if present in envelope
        const isValid = this.paymentProvider.verifyWebhook(envelope.data as unknown as Record<string, unknown>, signature, envelope.data.signatureKeys ?? []);
        console.log(`[PaymentWebhook] Signature verification result: ${isValid}`);
        if (!isValid) {
            throw InvalidWebhookSignatureError;
        }

        const dataObj = envelope.data;
        if (!dataObj) {
            throw new AppError("Invalid webhook payload format", 400);
        }

        const providerEventId = envelope.event === "pay" ? dataObj.transactionId : (envelope.event + "_" + (dataObj.transactionId || Date.now().toString()));
        if (!providerEventId) {
            throw new AppError("Webhook missing unique transactionId or event reference", 400);
        }

        // 3. Insert event to deduplicate webhooks
        const eventData: Partial<PaymentWebhookEventEntity> = {
            region,
            providerId: KASHIER_PROVIDER_ID,
            providerEventId: String(providerEventId),
            signature,
            payload: envelope,
        };

        const insertedEvent = await webhookRepo.insertWebhookEvent(eventData, db(region));
        if (!insertedEvent) {
            logger.info(`[PaymentWebhook] Webhook event ${providerEventId} already received/processed. Skipping.`);
            return;
        }

        // 4. Process the webhook lifecycle update inside a database transaction
        const conn = await db(region).transaction();
        try {
            // Find associated order
            const order = await orderRepo.findOrderByPublicId((dataObj.merchantOrderId || dataObj.orderReference) as string, conn);
            if (!order) {
                throw new AppError(`Order ${dataObj.merchantOrderId || dataObj.orderReference} not found locally`, 404);
            }

            // Find payment session via the order (latest active session)
            const session = await sessionRepo.findPaymentSessionByOrderId(order.id, conn);
            if (!session) {
                throw new AppError(`No active payment session found for order ${order.publicId}`, 404);
            }

            // Process event types: pay, refund, etc.
            if (envelope.event === "pay" || dataObj.status === "SUCCESS") {
                // Update session state
                await sessionRepo.updatePaymentSessionStatus(String(session.id), PaymentSessionStatus.CAPTURED, envelope, conn);

                // Fetch branch to obtain restaurant owner's user ID for transactions ledger
                let restaurantOwnerId: string | null = null;
                try {
                    const branch = await getBranch(Number(order.branchId));
                    if (branch && branch.restaurantOwnerId) {
                        restaurantOwnerId = String(branch.restaurantOwnerId);
                    }
                } catch (branchErr: any) {
                    logger.warn(`[PaymentWebhook] Failed to fetch branch owner for branch ${order.branchId}:`, branchErr);
                }

                // Check if transaction ledger entry exists
                const existingTx = await transactionRepo.findTransactionByProviderReference(String(dataObj.transactionId), conn);
                if (!existingTx) {
                    // Create Charge transaction
                    const txData: Partial<TransactionEntity> = {
                        region,
                        orderId: Number(order.id),
                        transactionType: TransactionType.CHARGE,
                        method: TransactionMethod.ONLINE,
                        providerId: kashierProvider.id,
                        providerReferenceId: String(dataObj.transactionId),
                        status: TransactionStatus.SUCCEEDED,
                        amount: session.amount,
                        currency: session.currency,
                        srcAccId: Number(order.customerId),
                        dstAccId: restaurantOwnerId
                            ? Number(restaurantOwnerId)
                            : Number(order.restaurantId),
                        isRefunded: false,
                        idempotencyKey: `kashier:${String(dataObj.transactionId)}`,
                    };
                    await transactionRepo.createTransaction(txData, conn);
                }

                // Insert payment.completed outbox event (transactional)
                await insertOutboxEvent(conn, {
                    aggregateType: "payment",
                    aggregateId: order.publicId,
                    eventType: EVENT_TYPES.PAYMENT_COMPLETED,
                    payload: {
                        orderId: order.publicId,
                        region,
                        restaurantId: Number(order.restaurantId),
                        branchId: Number(order.branchId),
                        customerId: Number(order.customerId),
                        provider: "kashier",
                        providerReferenceId: String(dataObj.transactionId),
                        amount: session.amount,
                        currency: session.currency,
                        method: "online",
                        completedAt: new Date().toISOString(),
                    },
                });

                // Advance order status from pending_payment to placed
                if (order.status === OrderStatus.PENDING_PAYMENT) {
                    const placed = await orderRepo.updateOrderStatus(order.publicId, OrderStatus.PLACED, conn);

                    // Now the order is officially placed — emit order.placed for analytics with items snapshot
                    const items = await itemRepo.findItemsByOrderIds([placed.id], region, conn);
                    await insertOutboxEvent(conn, {
                        aggregateType: "order",
                        aggregateId: placed.publicId,
                        eventType: EVENT_TYPES.ORDER_PLACED,
                        payload: {
                            orderId: placed.publicId,
                            region: placed.region,
                            countryCode: placed.countryCode,
                            restaurantId: Number(placed.restaurantId),
                            branchId: Number(placed.branchId),
                            customerId: Number(placed.customerId),
                            status: placed.status,
                            paymentMethod: placed.paymentMethod,
                            subtotal: placed.subtotal,
                            deliveryFee: placed.deliveryFee,
                            serviceFee: placed.serviceFee,
                            total: placed.total,
                            currency: placed.currency,
                            items: items.map((i) => ({
                                productId: Number(i.productId),
                                quantity: i.quantity,
                                unitPrice: i.unitPriceSnapshot,
                                lineTotal: i.lineTotal,
                            })),
                            placedAt: placed.createdAt.toISOString(),
                        },
                    });

                    // Post-commit WS announcements after commit
                    (conn as any).userContext = {
                        triggerWsBroadcast: true,
                        placed,
                        itemsCount: items.length,
                    };
                }
            } else if (dataObj.status === "FAILED") {
                // Update session state to failed
                await sessionRepo.updatePaymentSessionStatus(String(session.id), PaymentSessionStatus.FAILED, envelope, conn);

                // Create failed transaction ledger entry
                const existingTx = await transactionRepo.findTransactionByProviderReference(String(dataObj.transactionId), conn);
                if (!existingTx) {
                    const txData: Partial<TransactionEntity> = {
                        region,
                        orderId: Number(order.id),
                        transactionType: TransactionType.CHARGE,
                        method: TransactionMethod.ONLINE,
                        providerId: kashierProvider.id,
                        providerReferenceId: String(dataObj.transactionId),
                        status: TransactionStatus.FAILED,
                        amount: session.amount,
                        currency: session.currency,
                        srcAccId: Number(order.customerId),
                        dstAccId: Number(order.restaurantId),
                        isRefunded: false,
                        idempotencyKey: `kashier:${String(dataObj.transactionId)}`,
                    };
                    await transactionRepo.createTransaction(txData, conn);
                }

                // Insert payment.failed outbox event
                await insertOutboxEvent(conn, {
                    aggregateType: "payment",
                    aggregateId: order.publicId,
                    eventType: EVENT_TYPES.PAYMENT_FAILED,
                    payload: {
                        orderId: order.publicId,
                        region,
                        restaurantId: Number(order.restaurantId),
                        branchId: Number(order.branchId),
                        customerId: Number(order.customerId),
                        provider: "kashier",
                        providerReferenceId: String(dataObj.transactionId),
                        amount: session.amount,
                        currency: session.currency,
                        method: "online",
                        failedAt: new Date().toISOString(),
                    },
                });
            }

            // Mark webhook event as processed
            await webhookRepo.updateWebhookEventStatus(String(insertedEvent.id), new Date(), null, conn);

            await conn.commit();

            // Perform post-commit tasks
            if ((conn as any).userContext?.triggerWsBroadcast) {
                const placedOrder = (conn as any).userContext.placed;
                const itemsCount = (conn as any).userContext.itemsCount ?? 0;
                // Invalidate cache
                await this.cacheProvider.del(RESTAURANT_ORDERS_CACHE_PREFIX(region, Number(placedOrder.branchId)));

                // WS Emits
                this.io.to(`branch:${placedOrder.branchId}`).emit("order.created", OrderSummaryResponseDTO.from(placedOrder, itemsCount));
                this.io.to(`customer:${placedOrder.customerId}`).emit("order.status_changed", OrderStatusResponseDTO.from(placedOrder));
                return;
            }
        } catch (error: any) {
            await conn.rollback();
            logger.error(`[PaymentWebhookException] Error processing webhook event:`, error);
            // Record failure error on webhook event row for troubleshooting
            const errMsg = error instanceof Error ? error.message : String(error);
            await webhookRepo.updateWebhookEventStatus(String(insertedEvent.id), new Date(), errMsg, db(region));
            throw error;
        }
    }
}

function parseEnvelope(rawBody: Buffer): KashierWebhookEnvelope {
    let parsed: any;
    try {
        parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
        throw MalformedWebhookError;
    }
    if (!parsed?.event || !parsed?.data?.transactionId) {
        throw MalformedWebhookError;
    }
    return parsed as KashierWebhookEnvelope;
}
