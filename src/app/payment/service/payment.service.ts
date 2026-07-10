import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {ICacheProvider} from "../../../pkg/cache/cache.interface";
import {Server} from "socket.io";
import {IPaymentProvider} from "../../../pkg/payments/types";
import {db} from "../../../lib/knex/knex";
import {AppError} from "../../../lib/error/AppError";
import {logger} from "../../../lib/logger/logger";
import {PaymentInitResponseDTO, PaymentResponseDTO} from "../dto/payment.dto";
import * as orderRepo from "../../order/repository/order.repo";
import * as providerRepo from "../repository/payment-provider.repo";
import * as sessionRepo from "../repository/payment-session.repo";
import * as transactionRepo from "../repository/transaction.repo";
import {findTransactionWithRestaurant} from "../repository/transaction.repo";
import {PaymentSessionEntity} from "../entity/payment-session.entity";
import {TransactionEntity} from "../entity/transaction.entity";
import {OrderStatus, PaymentMethod} from "../../order/enums";
import {
    PAYMENT_PROVIDER_IDS,
    PaymentProviderName,
    PaymentSessionStatus,
    TransactionStatus,
    TransactionType
} from "../enums";
import {UnAuthorisedError} from "../../../lib/auth/errors";
import {PaymentNotFoundError} from "../errors";
import {OrderEntity} from "../../order/entity/order.entity";
import {toMs} from "../../../pkg/utils/time";
import {env} from "../../../lib/config/env";
import {fromMinor} from "../../../pkg/utils/money";


const RESTAURANT_ORDERS_CACHE_PREFIX = (region: string, branchId: number) => `${region}:GET:/api/restaurant/orders?branchId=${branchId}`;

@injectable()
export class PaymentService {
    constructor(
        @inject(TOKENS.KashierProvider) private readonly paymentProvider: IPaymentProvider,
    ) {}

    async initializePaymentSession(
        order: OrderEntity
    ): Promise<PaymentInitResponseDTO> {
        const conn = db(order.region);
        const sessionTtlMs = toMs(env.payments.sessionTimeoutMin, "m");
        // // 3. Find enabled Kashier provider
        // const kashierProvider = await providerRepo.findProviderByName("kashier", db(region));
        // if (!kashierProvider || !kashierProvider.isEnabled) {
        //     throw new AppError("Online payment provider (Kashier) is not enabled", 400);
        // }

        // 4. Check if an active session already exists for this order to avoid duplicating session with Kashier
        const existingSession = await sessionRepo.findPaymentSessionByOrderId(order.id, conn);
        if (existingSession) {
            logger.info(`[PaymentService] Reusing existing active session ${existingSession.providerSessionId} for order ${order.publicId}`);
            const expiredAt = new Date(existingSession.createdAt.getTime() + sessionTtlMs).toISOString();
            return PaymentInitResponseDTO.from(existingSession, expiredAt);
        }


        // 6. Call Kashier Gateway
        const sessionResult = await this.paymentProvider.createSession({
            merchantOrderId: order.publicId,
            amount: fromMinor(order.total).toFixed(2),
            currency: order.currency,
            description: `QuickBite order ${order.publicId}`,
            allowedMethods: "card,wallet",
            customerReference: String(order.customerId),
        });

        // 7. Store local session in Database
        const sessionData: Partial<PaymentSessionEntity> = {
            region: order.region,
            orderId: order.id,
            providerId: PAYMENT_PROVIDER_IDS[PaymentProviderName.KASHIER],
            providerSessionId: sessionResult.providerSessionId,
            redirectUrl: sessionResult.redirectUrl,
            amount: order.total,
            currency: order.currency,
            status: PaymentSessionStatus.INITIALIZED,
            rawInitPayload: sessionResult.rawResponse,
        };

        const newSession = await sessionRepo.createPaymentSession(sessionData, conn);
        const expiresAt = sessionResult.expiresAt ?? new Date(newSession.createdAt.getTime() + 15 * 60 * 1000).toISOString();
        return PaymentInitResponseDTO.from(newSession, expiresAt);
    }

    async getPaymentDetails(paymentId: string, region: string): Promise<any> {
        const session = await sessionRepo.findPaymentSessionByProviderId(paymentId, db(region));
        if (!session) throw new AppError("Payment session not found", 404);
        return session;
    }

    async refundPayment(
        transactionId: string,
        amount: number, // minor units
        region: string
    ): Promise<PaymentResponseDTO> {
        const conn = await db(region).transaction();
        try {
            // 1. Fetch transaction
            const tx = await transactionRepo.findTransactionById(transactionId, conn);
            if (!tx) {
                throw new AppError("Transaction not found", 404);
            }

            if (tx.transactionType !== "charge" || tx.status !== "succeeded") {
                throw new AppError("Only successful charge transactions can be refunded", 400);
            }

            if (tx.isRefunded) {
                throw new AppError("This transaction has already been refunded", 400);
            }

            if (amount > tx.amount) {
                throw new AppError(`Refund amount (${amount}) exceeds original charge amount (${tx.amount})`, 400);
            }

            // 2. Fetch order
            let orderPublicId: string | null = null;
            if (tx.orderId) {
                const order = await conn("orders").where({id: tx.orderId}).first();
                if (order) {
                    orderPublicId = order.public_id;
                }
            }

            // 3. Process refund with Kashier provider
            const refundRes = await this.paymentProvider.refund({
                providerReferenceId: tx.providerReferenceId || "",
                amount,
                currency: tx.currency,
            });

            if (!refundRes.success) {
                throw new AppError(`Kashier refund process failed: ${JSON.stringify(refundRes.rawResponse)}`, 400);
            }

            // 4. Mark transaction as refunded and create refund row
            await transactionRepo.markTransactionAsRefunded(tx.id, conn);

            const refundTxData: Partial<TransactionEntity> = {
                region,
                orderId: tx.orderId,
                transactionType: TransactionType.REFUND,
                method: tx.method,
                providerId: tx.providerId,
                providerReferenceId: refundRes.providerReferenceId,
                status: TransactionStatus.SUCCEEDED,
                amount,
                currency: tx.currency,
                srcAccId: tx.dstAccId, // refund from merchant/platform
                dstAccId: tx.srcAccId, // refund back to customer
                isRefunded: false,
                refundedPaymentId: tx.id,
            };

            const refundTx = await transactionRepo.createTransaction(refundTxData, conn);

            await conn.commit();
            return PaymentResponseDTO.from(refundTx);
        } catch (error: any) {
            await conn.rollback();
            logger.error(`[PaymentServiceException] refundPayment error:`, error);
            throw error;
        }
    }

     async getById(paymentId: number, restaurantId: number, region: string): Promise<PaymentResponseDTO> {
        const conn = db(region);
        const found = await findTransactionWithRestaurant(paymentId, conn);
        if (!found) throw PaymentNotFoundError;

        if (found.restaurantId !== null && found.restaurantId !== restaurantId) {
            // The middleware verified the caller's right to see "restaurantId",
            // but the transaction belongs to a different restaurant.
            throw UnAuthorisedError;
        }

        return PaymentResponseDTO.from(found.transaction);
    }
}
