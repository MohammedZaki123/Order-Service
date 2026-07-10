
import {Knex} from "knex";
import {PaymentSessionEntity} from "../entity/payment-session.entity";
import {PaymentSessionStatus} from "../enums";

const SESSION_COLUMNS = [
    "id", "region", "order_id", "provider_id", "provider_session_id",
    "redirect_url", "amount", "currency", "status", "raw_init_payload",
    "raw_last_payload", "created_at", "updated_at"
];

function toEntity(row: any): PaymentSessionEntity {
    return new PaymentSessionEntity({
        id: Number(row.id),
        region: row.region,
        orderId: Number(row.order_id),
        providerId: Number(row.provider_id),
        providerSessionId: row.provider_session_id,
        redirectUrl: row.redirect_url,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status as PaymentSessionStatus,
        rawInitPayload: row.raw_init_payload,
        rawLastPayload: row.raw_last_payload,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    });
}

export async function createPaymentSession(
    data: Partial<PaymentSessionEntity>,
    conn: Knex
): Promise<PaymentSessionEntity> {
    const [row] = await conn("payment_sessions").insert({
        region: data.region,
        order_id: data.orderId,
        provider_id: data.providerId,
        provider_session_id: data.providerSessionId,
        redirect_url: data.redirectUrl,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        raw_init_payload: data.rawInitPayload ? JSON.stringify(data.rawInitPayload) : null,
        raw_last_payload: data.rawLastPayload ? JSON.stringify(data.rawLastPayload) : null,
        created_at: data.createdAt || new Date(),
        updated_at: data.updatedAt || new Date(),
    }).returning(SESSION_COLUMNS);
    return toEntity(row);
}

export async function findPaymentSessionByProviderId(
    providerSessionId: string,
    conn: Knex
): Promise<PaymentSessionEntity | undefined> {
    const row = await conn("payment_sessions")
        .select(SESSION_COLUMNS)
        .where({provider_session_id: providerSessionId})
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findPaymentSessionByOrderId(
    orderId: number,
    conn: Knex
): Promise<PaymentSessionEntity | undefined> {
    const row = await conn("payment_sessions")
        .select(SESSION_COLUMNS as unknown as string[])
        .where("order_id", orderId)
        .whereIn("status", [PaymentSessionStatus.INITIALIZED, PaymentSessionStatus.PENDING])
        .orderBy("id", "desc")
        .first();
    return row ? toEntity(row) : undefined;
}

export async function updatePaymentSessionStatus(
    id: string,
    status: PaymentSessionEntity["status"],
    lastPayload: unknown,
    conn: Knex
): Promise<PaymentSessionEntity> {
    const [row] = await conn("payment_sessions")
        .where({id})
        .update({
            status,
            raw_last_payload: lastPayload ? JSON.stringify(lastPayload) : null,
            updated_at: new Date(),
        })
        .returning(SESSION_COLUMNS);
    return toEntity(row);
}
