import { Knex } from "knex";
import { RestaurantBalanceEntity } from "../entity/restaurant-balance.entity";
import { db } from "../../../lib/knex/knex";

function toEntity(row: any): RestaurantBalanceEntity {
    return new RestaurantBalanceEntity({
        restaurantId: Number(row.restaurant_id),
        region: row.region,
        currency: row.currency,
        balance: Number(row.balance),
        updatedAt: new Date(row.updated_at),
    });
}
const COLUMNS = ["restaurant_id", "region", "currency", "balance", "updated_at"] as const;

/**
 * SELECT ... FOR UPDATE on the balance row. Must be called inside a transaction.
 */
export async function lockBalance(
    restaurantId: number,
    currency: string,
    conn: Knex
): Promise<RestaurantBalanceEntity | undefined> {
    const row = await conn("restaurant_balances")
        .where({ restaurant_id: restaurantId, currency })
        .forUpdate()
        .first();
    return row ? toEntity(row) : undefined;
}

/**
 * Upsert balance — creates row if missing, increments delta atomically.
 * delta may be negative (e.g. payout deduction).
 */
export async function upsertBalance(
    restaurantId: number,
    region: string,
    currency: string,
    delta: number,
    conn: Knex  
): Promise<void> {
    await conn.raw(
        `INSERT INTO restaurant_balances (restaurant_id, region, currency, balance, updated_at)
         VALUES (?, ?, ?, ?, NOW())
         ON CONFLICT (restaurant_id, currency)
         DO UPDATE SET balance = restaurant_balances.balance + ?, updated_at = NOW()
         RETURNING ${COLUMNS.join(",")}`,
        [restaurantId, region,currency, delta,delta]
    );
}

export async function findBalancesByRestaurant(
    restaurantId: number,
    conn: Knex
): Promise<RestaurantBalanceEntity[]> {
    const rows = await conn("restaurant_balances")
        .where({ restaurant_id: restaurantId });
    return rows.map(toEntity);
}

export async function findBalanceByCurrency(
    restaurantId: string,
    currency: string,
    region: string,
    conn: Knex = db(region)
): Promise<RestaurantBalanceEntity | undefined> {
    const row = await conn("restaurant_balances")
        .where({ restaurant_id: restaurantId, currency });
    return row ? toEntity(row) : undefined;
}

