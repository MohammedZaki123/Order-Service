import {injectable} from "tsyringe";
import {db} from "../../../lib/knex/knex";
import {AppError} from "../../../lib/error/AppError";
import * as orderRepo from "../../order/repository/order.repo";
import * as balanceRepo from "../repository/restaurant-balance.repo";
import * as transactionRepo from "../../payment/repository/transaction.repo";
import {
    PayoutResponseDTO,
    RestaurantBalanceResponseDTO,
} from "../dto/finance.response.dto";
import {TransactionMethod, TransactionStatus, TransactionType} from "../../payment/enums";
import {InsufficientBalanceError} from "../errors";
import {logger} from "../../../lib/logger/logger";

@injectable()
export class FinanceService {
    async getBalance(
        restaurantId: number,
        region: string
    ): Promise<RestaurantBalanceResponseDTO> {
        const conn = db(region);
        const rows = await balanceRepo.findBalancesByRestaurant(restaurantId, conn);
        return RestaurantBalanceResponseDTO.from(restaurantId, rows);
    }

    async listPayouts(
        restaurantId: number,
        region: string,
        from: Date,
        to: Date,
        limit: number = 50,
        cursor?: string
    ): Promise<PayoutResponseDTO[]> {
        const conn = db(region);
        const ownerUserId = await orderRepo.findRestaurantOwnerId(restaurantId, region,conn);
        if (!ownerUserId) {
            throw new AppError("Restaurant owner could not be resolved", 404);
        }
        const txs = await transactionRepo.findPayouts(
            ownerUserId,
            region,
            from,
            to,
            conn
        );
        return txs.map(PayoutResponseDTO.fromTransaction);
    }

    async recordPayout(input: {
        restaurantId: number;
        amount: number;
        currency: string;
        region: string;
        providerReferenceId: string;
        idempotencyKey: string;
        note?: string;
    }): Promise<PayoutResponseDTO> {
        const conn = db(input.region);
        const ownerUserId = await orderRepo.findRestaurantOwnerId(input.restaurantId, input.region, conn);
        if (!ownerUserId) {
            throw new AppError("Restaurant owner could not be resolved", 404);
        }
        const trx = await conn.transaction();

        try {
            const existing = await trx("transactions")
                .where({idempotency_key: input.idempotencyKey})
                .first();
            if (existing) {
                await trx.commit();
                return PayoutResponseDTO.fromRow(existing);
            }

            const balance = await balanceRepo.lockBalance(
                input.restaurantId,
                input.currency,
                trx
            );
            if (!balance || balance.balance < input.amount) {
                throw InsufficientBalanceError;
            }

            await balanceRepo.upsertBalance(
                input.restaurantId,
                input.region,
                input.currency,
                -input.amount,
                trx
            );

            const payoutTransaction = await transactionRepo.createTransaction({
                region: input.region,
                orderId: null,
                transactionType: TransactionType.PAYOUT,
                method: TransactionMethod.BANK_TRANSFER,
                providerId: null,
                providerReferenceId: input.providerReferenceId,
                status: TransactionStatus.SUCCEEDED,
                amount: input.amount,
                currency: input.currency,
                srcAccId: null,
                dstAccId: ownerUserId,
                isRefunded: false,
                idempotencyKey: input.idempotencyKey,
                createdAt: new Date(),
                updatedAt: new Date(),
            }, trx)

            await trx.commit();
            logger.info("Payout recorded", {
                restaurantId: input.restaurantId,
                amount: input.amount,
                currency: input.currency,
            });
            return PayoutResponseDTO.fromTransaction(payoutTransaction);
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}
