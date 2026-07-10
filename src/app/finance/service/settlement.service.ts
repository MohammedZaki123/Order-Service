import {injectable} from "tsyringe";
import {Knex} from "knex";
import {OrderEntity} from "../../order/entity/order.entity";
import {PaymentMethod} from "../../order/enums";
import {TransactionMethod, TransactionStatus, TransactionType} from "../../payment/enums";
import * as transactionRepo from "../../payment/repository/transaction.repo";
import * as agentEarningRepo from "../../agent/repository/agent-earning.repo";
import * as balanceRepo from "../repository/restaurant-balance.repo";
import {env} from "../../../lib/config/env";
import {logger} from "../../../lib/logger/logger";
import {insertOutboxEvent} from "../../../lib/events/outbox.repo";
import {EVENT_TYPES} from "../../../lib/events/event-types";
import {getBranch} from "../../../lib/core-client/branch.client";

@injectable()
export class SettlementService {
    /**
     * Financial settlement when an order is delivered (single DB trx with caller).
     *
     * This function orchestrates:
     * 1. Commission calculation from branch config
     * 2. COD collection recording (if applicable)
     * 3. Commission transaction ledger
     * 4. Service fee transfer to platform
     * 5. Delivery fee transfer to platform
     * 6. Net restaurant balance crediting
     * 7. Agent earning recording
     * 8. Transactional outbox event emission
     */
    async settleDeliveredOrder(
        order: OrderEntity,
        agentId: number,
        conn: Knex
    ): Promise<{agentEarningAmount: number}> {
        // Pre-transaction fetch (read-only) so we can pull commissionBps from core's cache
        // without holding row locks across an HTTP call.
        let commissionBps = 0;
        try {
            const branch = await getBranch(Number(order.branchId));
            commissionBps = Number(branch.commissionBps ?? 0);
        } catch (err) {
            logger.warn("settlement: branch fetch failed; commission set to 0", {
                publicId: order.publicId,
                error: (err as Error).message
            });
        }
        // Platform Commission
        const commission = Math.floor((order.subtotal * commissionBps) / 10000);
        const agentEarningAmount = Math.floor((order.deliveryFee * env.delivery.agentEarningShareBps) / 10000);
        // TODO: update order record with commission and agentEarningAmount for reporting


        // For COD, write the charge transaction now (succeeded; the agent took the cash).
        if (order.paymentMethod === PaymentMethod.COD) {
            const existingCod = await transactionRepo.findTransactionByOrderAndType(
                order.id,
                TransactionType.COD_COLLECTION,
                conn
            );
            if (!existingCod) {
                await transactionRepo.createTransaction(
                    {
                        region: order.region,
                        orderId: Number(order.id),
                        transactionType: TransactionType.COD_COLLECTION,
                        method: TransactionMethod.COD,
                        providerId: null,
                        providerReferenceId: null,
                        status: TransactionStatus.SUCCEEDED,
                        amount: order.total,
                        currency: order.currency,
                        srcAccId: Number(order.customerId),
                        dstAccId: Number(order.restaurantOwnerId),
                        idempotencyKey: `cod-collect:${order.publicId}`,
                    },
                    conn
                );
            } else if (existingCod.status !== TransactionStatus.SUCCEEDED) {
                // Update pending COD to succeeded
                await transactionRepo.updateTransactionStatus(
                    String(existingCod.id),
                    TransactionStatus.SUCCEEDED,
                    conn
                );
            }
        }

        // Commission: src=restaurant owner, dst=NULL (platform — no user record).
        if (commission > 0) {
            const existingCommission = await transactionRepo.findTransactionByOrderAndType(
                order.id,
                TransactionType.COMMISSION,
                conn
            );
            if (!existingCommission) {
                await transactionRepo.createTransaction(
                    {
                        region: order.region,
                        orderId: Number(order.id),
                        transactionType: TransactionType.COMMISSION,
                        method: TransactionMethod.SYSTEM,
                        providerId: null,
                        providerReferenceId: null,
                        status: TransactionStatus.SUCCEEDED,
                        amount: commission,
                        currency: order.currency,
                        srcAccId: Number(order.restaurantOwnerId),
                        dstAccId: null,
                        idempotencyKey: `commission:${order.publicId}`,
                    },
                    conn
                );
            }
        }

        // Service fee: customer paid it as part of `total`. For COD the
        // cod_collection above credits `total` to the restaurant owner;
        // the service fee is owed back to the platform. Book the
        // restaurant → platform transfer explicitly so finance reconciles.
        if (order.serviceFee > 0) {
            const existingServiceFee = await transactionRepo.findTransactionByOrderAndType(
                order.id,
                TransactionType.ADJUSTMENT,
                conn
            );
            if (!existingServiceFee) {
                await transactionRepo.createTransaction(
                    {
                        region: order.region,
                        orderId: order.id,
                        transactionType: TransactionType.ADJUSTMENT,
                        method: TransactionMethod.SYSTEM,
                        providerId: null,
                        providerReferenceId: null,
                        status: TransactionStatus.SUCCEEDED,
                        amount: order.serviceFee,
                        currency: order.currency,
                        srcAccId: Number(order.restaurantOwnerId),
                        dstAccId: null,
                        idempotencyKey: `service-fee:${order.publicId}`,
                    },
                    conn
                );
            }
        }

        // Delivery fee: same story — customer paid it inside `total`, it's
        // not the restaurant's money. Book restaurant → platform; the
        // agent's share is paid out separately via agent_earnings.
        if (order.deliveryFee > 0) {
            const existingDeliveryFee = await transactionRepo.findTransactionByOrderAndType(
                order.id,
                TransactionType.ADJUSTMENT,
                conn
            );
            if (!existingDeliveryFee) {
                await transactionRepo.createTransaction(
                    {
                        region: order.region,
                        orderId: Number(order.id),
                        transactionType: TransactionType.ADJUSTMENT,
                        method: TransactionMethod.SYSTEM,
                        providerId: null,
                        providerReferenceId: null,
                        status: TransactionStatus.SUCCEEDED,
                        amount: order.deliveryFee,
                        currency: order.currency,
                        srcAccId: Number(order.restaurantOwnerId),
                        dstAccId: null,
                        idempotencyKey: `delivery-fee:${order.publicId}`,
                    },
                    conn
                );
            }
        }

        // Restaurant balance: net of commission.
        const netToRestaurant = order.subtotal - commission;
        if (netToRestaurant !== 0) {
            await balanceRepo.lockBalance(order.restaurantId, order.currency, conn);
            await balanceRepo.upsertBalance(
                order.restaurantId,
                order.region,
                order.currency,
                netToRestaurant,
                conn
            );
        }

        // Agent earning. UNIQUE(order_id) makes this idempotent.
        if (agentEarningAmount > 0) {
            await agentEarningRepo.insertEarning(
                {
                    region: order.region,
                    agentId,
                    orderId: order.id,
                    amount: agentEarningAmount,
                    currency: order.currency,
                },
                conn
            );
        }

        // Transactional outbox — order.delivered for analytics + future consumers.
        // Same trx so a publish never escapes a rolled-back settlement.
        await insertOutboxEvent(conn, {
            aggregateType: "order",
            aggregateId: order.publicId,
            eventType: EVENT_TYPES.ORDER_DELIVERED,
            payload: {
                orderId: order.publicId,
                region: order.region,
                restaurantId: Number(order.restaurantId),
                branchId: Number(order.branchId),
                customerId: Number(order.customerId),
                deliveryAgentId: agentId,
                total: order.total,
                subtotal: order.subtotal,
                deliveryFee: order.deliveryFee,
                commission,
                currency: order.currency,
                paymentMethod: order.paymentMethod,
                deliveredAt: new Date().toISOString(),
            },
        });

        logger.info("Order settlement completed", {
            orderId: order.publicId,
            commission,
            netToRestaurant,
            agentEarningAmount,
        });

        return {agentEarningAmount};
    }
}
