import {Knex} from "knex";
import {OrderItemEntity} from "../entity/order-item.entity";
import {db} from "../../../lib/knex/knex";

const ITEM_COLUMNS = [
    "id", "region", "order_id", "product_id", "quantity",
    "unit_price_snapshot", "name_snapshot", "image_url_snapshot", "line_total", "created_at"
];

function toEntity(row: any): OrderItemEntity {
    return new OrderItemEntity({
        id: Number(row.id),
        region: row.region,
        orderId: Number(row.order_id),
        productId: Number(row.product_id),
        quantity: Number(row.quantity),
        unitPriceSnapshot: Number(row.unit_price_snapshot),
        nameSnapshot: row.name_snapshot,
        imageUrlSnapshot: row.image_url_snapshot,
        lineTotal: Number(row.line_total),
        createdAt: row.created_at,
    });
}

export async function bulkInsertItems(items: Partial<OrderItemEntity>[], conn: Knex ): Promise<OrderItemEntity[]> {
    const rows = await conn("order_items").insert(items.map(item => ({
        region: item.region,
        order_id: item.orderId,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price_snapshot: item.unitPriceSnapshot,
        name_snapshot: item.nameSnapshot,
        image_url_snapshot: item.imageUrlSnapshot,
        line_total: item.lineTotal,
        created_at: item.createdAt || new Date(),
    }))).returning(ITEM_COLUMNS);
    return rows.map(toEntity);
}

export async function findItemsByOrderIds(orderIds: number[], region: string, conn: Knex = db(region)): Promise<OrderItemEntity[]> {
    if (orderIds.length === 0) return [];
    const rows = await conn("order_items")
        .select(ITEM_COLUMNS)
        .whereIn("order_id", orderIds)
        .orderBy("id", "asc");
    return rows.map(toEntity);
}

export async function countItemsByOrderIds(orderIds: number[], conn: Knex): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (orderIds.length === 0) return out;
    const rows = await conn("order_items")
        .select("order_id")
        .count<{order_id: string; count: string}[]>("* as count")
        .whereIn("order_id", orderIds)
        .groupBy("order_id");
    for (const r of rows) out.set(Number(r.order_id), Number(r.count));
    return out;
}
