import {Knex} from "knex";
import {TransactionEntity} from "../entity/transaction.entity";
import { TransactionMethod, TransactionStatus, TransactionType } from "../enums";

const TRANSACTION_COLUMNS = [
    "id", "region", "order_id", "transaction_type", "method",
    "provider_id", "provider_reference_id", "status", "amount", "currency",
    "src_acc_id", "dst_acc_id", "is_refunded", "refunded_payment_id",
    "idempotency_key", "created_at", "updated_at"
];

function toEntity(row: any): TransactionEntity {
    return new TransactionEntity({
        id: Number(row.id),
        region: row.region,
        orderId: row.order_id ? Number(row.order_id) : null,
        transactionType: row.transaction_type as TransactionType,
        method: row.method as TransactionMethod,
        providerId: row.provider_id ? Number(row.provider_id) : null,
        providerReferenceId: row.provider_reference_id,
        status: row.status as TransactionStatus,
        amount: Number(row.amount),
        currency: row.currency,
        srcAccId: row.src_acc_id ? Number(row.src_acc_id) : null,
        dstAccId: row.dst_acc_id ? Number(row.dst_acc_id) : null,
        isRefunded: Boolean(row.is_refunded),
        refundedPaymentId: row.refunded_payment_id ? Number(row.refunded_payment_id) : null,
        idempotencyKey: row.idempotency_key,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    });
}

export async function createTransaction(
    data: Partial<TransactionEntity>,
    conn: Knex
): Promise<TransactionEntity> {
    const [row] = await conn("transactions").insert({
        region: data.region,
        order_id: data.orderId || null,
        transaction_type: data.transactionType,
        method: data.method,
        provider_id: data.providerId || null,
        provider_reference_id: data.providerReferenceId || null,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        src_acc_id: data.srcAccId || null,
        dst_acc_id: data.dstAccId || null,
        is_refunded: data.isRefunded || false,
        refunded_payment_id: data.refundedPaymentId || null,
        idempotency_key: data.idempotencyKey || null,
        created_at: data.createdAt || new Date(),
        updated_at: data.updatedAt || new Date(),
    }).onConflict("idempotency_key").ignore().returning(TRANSACTION_COLUMNS);

    return toEntity(row);
}

export async function findTransactionById(
    id: string,
    conn: Knex
): Promise<TransactionEntity | undefined> {
    const row = await conn("transactions")
        .select(TRANSACTION_COLUMNS)
        .where({id})
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findTransactionByProviderReference(
    refId: string,
    conn: Knex
): Promise<TransactionEntity | undefined> {
    const row = await conn("transactions")
        .select(TRANSACTION_COLUMNS)
        .where({provider_reference_id: refId})
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findTransactionsByOrderId(
    orderId: string,
    conn: Knex
): Promise<TransactionEntity[]> {
    const rows = await conn("transactions")
        .select(TRANSACTION_COLUMNS)
        .where({order_id: orderId});
    return rows.map(toEntity);
}

export async function updateTransactionStatus(
    id: string,
    status: TransactionEntity["status"],
    conn: Knex
): Promise<TransactionEntity> {
    const [row] = await conn("transactions")
        .where({id})
        .update({
            status,
            updated_at: new Date(),
        })
        .returning(TRANSACTION_COLUMNS);
    return toEntity(row);
}

export async function markTransactionAsRefunded(
    id: Number,
    conn: Knex
): Promise<void> {
    await conn("transactions")
        .where({id})
        .update({
            is_refunded: true,
            updated_at: new Date(),
        });
}


export async function findTransactionWithRestaurant(id: number, conn: Knex): Promise<TransactionWithOwner | undefined> {
    const row = await conn("transactions as t")
        .leftJoin("orders as o", "o.id", "t.order_id")
        .select([
            ...TRANSACTION_COLUMNS.map((c) => `t.${c} as ${c}`),
            "o.restaurant_id as _restaurant_id",
        ])
        .where("t.id", id)
        .first();
    if (!row) return undefined;
    return {
        transaction: toEntity(row),
        restaurantId: row._restaurant_id !== null && row._restaurant_id !== undefined ? Number(row._restaurant_id) : null,
    };
}


export interface TransactionWithOwner {
    transaction: TransactionEntity;
    /** The owning order's restaurant id (NULL for txs not tied to an order, e.g. payouts). */
    restaurantId: number | null;
}

export async function findPayouts(
    ownerId: number,
    region: string,
    from: Date,
    to: Date,
    conn: Knex,
    limit: number = 50,
    cursor?: string
): Promise<TransactionEntity[]> {
    let query = conn("transactions")
        .select(TRANSACTION_COLUMNS)
        .where({
            region,
            transaction_type: "payout",
            dst_acc_id: ownerId,
        })
        .whereBetween("created_at", [from, to])
        .orderBy("created_at", "desc")
        .limit(limit);

    if (cursor) {
        query = query.where("created_at", "<", cursor);
    }

    const rows = await query;
    return rows.map(toEntity);
}

export async function findTransactionByOrderAndType(
    orderId: number,
    transactionType: string,
    conn: Knex
): Promise<TransactionEntity | undefined> {
    const row = await conn("transactions")
        .select(TRANSACTION_COLUMNS)
        .where({
            order_id: orderId,
            transaction_type: transactionType
        })
        .first();
    return row ? toEntity(row) : undefined;
}

export async function insertTransaction(
    data: Partial<TransactionEntity>,
    conn: Knex
): Promise<TransactionEntity> {
    return createTransaction(data, conn);
}

