import {Knex} from "knex";
import {PaymentWebhookEventEntity} from "../entity/payment-webhook-event.entity";

const WEBHOOK_COLUMNS = [
    "id", "region", "provider_id", "provider_event_id", "signature", "payload",
    "received_at", "processed_at", "process_error"
];

function toEntity(row: any): PaymentWebhookEventEntity {
    return new PaymentWebhookEventEntity({
        id: row.id,
        region: row.region,
        providerId: Number(row.provider_id),
        providerEventId: row.provider_event_id,
        signature: row.signature,
        payload: row.payload,
        receivedAt: new Date(row.received_at),
        processedAt: row.processed_at ? new Date(row.processed_at) : null,
        processError: row.process_error || null,
    });
}

export async function insertWebhookEvent(
    data: Partial<PaymentWebhookEventEntity>,
    conn: Knex
): Promise<PaymentWebhookEventEntity | undefined> {
    const insertObj = {
        region: data.region,
        provider_id: data.providerId,
        provider_event_id: data.providerEventId,
        signature: data.signature,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        received_at: data.receivedAt || new Date(),
        processed_at: data.processedAt || null,
        process_error: data.processError || null,
    };

    const sql = conn("payment_webhook_events")
        .insert(insertObj)
        .toString() + " ON CONFLICT (provider_id, provider_event_id) DO NOTHING RETURNING *";

    const result = await conn.raw(sql);
    const row = result.rows?.[0];
    return row ? toEntity(row) : undefined;
}

export async function updateWebhookEventStatus(
    id: string,
    processedAt: Date | null,
    processError: string | null,
    conn: Knex
): Promise<void> {
    await conn("payment_webhook_events")
        .where({id})
        .update({
            processed_at: processedAt,
            process_error: processError,
        });
}
