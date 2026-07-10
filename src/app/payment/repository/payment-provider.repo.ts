import {Knex} from "knex";
import {PaymentProviderEntity} from "../entity/payment-provider.entity";

const PROVIDER_COLUMNS = ["id", "name", "is_enabled", "priority"];

function toEntity(row: any): PaymentProviderEntity {
    return new PaymentProviderEntity({
        id: Number(row.id),
        name: row.name,
        isEnabled: Boolean(row.is_enabled),
        priority: Number(row.priority),
    });
}

export async function findProviderById(id: number, conn: Knex): Promise<PaymentProviderEntity | undefined> {
    const row = await conn("payment_providers")
        .select(PROVIDER_COLUMNS)
        .where({id})
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findProviderByName(name: string, conn: Knex): Promise<PaymentProviderEntity | undefined> {
    const row = await conn("payment_providers")
        .select(PROVIDER_COLUMNS)
        .where({name})
        .first();
    return row ? toEntity(row) : undefined;
}

export async function listEnabledProviders(conn: Knex): Promise<PaymentProviderEntity[]> {
    const rows = await conn("payment_providers")
        .select(PROVIDER_COLUMNS)
        .where({is_enabled: true})
        .orderBy("priority", "asc");
    return rows.map(toEntity);
}
