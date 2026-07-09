import {Knex} from "knex";
import {OrderEntity} from "../entity/order.entity";
import {Currency, OrderStatus, PaymentMethod} from "../enums";
import {db} from "../../../lib/knex/knex";
import {
    applyCursorPagination, applyFilters,
    buildPaginationResult, FilterParams,
    PaginationParams
} from "../../../lib/http/pagination/cursor-pagination";

const ORDER_COLUMNS = [
    "id", "region", "public_id", "country_code", "restaurant_id", "restaurant_owner_id", "branch_id",
    "customer_id", "customer_address_id", "delivery_lat", "delivery_lng",
    "delivery_address_text_snapshot", "branch_lat", "branch_lng", "status", "subtotal", "delivery_fee",
    "service_fee", "total", "commission", "currency", "payment_method",
    "delivery_agent_id", "created_at", "updated_at", "accepted_at",
    "rejected_at", "ready_at", "assigned_at", "picked_at", "delivered_at",
    "cancelled_at"
];

function toEntity(row: any): OrderEntity {
    return new OrderEntity({
        id: Number(row.id),
        region: row.region,
        publicId: row.public_id,
        countryCode: row.country_code,
        restaurantId: Number(row.restaurant_id),
        restaurantOwnerId: Number(row.restaurant_owner_id),
        branchId: Number(row.branch_id),
        customerId: Number(row.customer_id),
        customerAddressId: Number(row.customer_address_id),
        deliveryLat: Number(row.delivery_lat),
        deliveryLng: Number(row.delivery_lng),
        deliveryAddressTextSnapshot: row.delivery_address_text_snapshot,
        branchLat: Number(row.branch_lat),
        branchLng: Number(row.branch_lng),
        status: row.status as OrderStatus,
        subtotal: Number(row.subtotal),
        deliveryFee: Number(row.delivery_fee),
        serviceFee: Number(row.service_fee),
        total: Number(row.total),
        commission: Number(row.commission),
        currency: row.currency as Currency,
        paymentMethod: row.payment_method as PaymentMethod,
        deliveryAgentId: row.delivery_agent_id !== null && row.delivery_agent_id !== undefined ? Number(row.delivery_agent_id) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        acceptedAt: row.accepted_at,
        rejectedAt: row.rejected_at,
        readyAt: row.ready_at,
        assignedAt: row.assigned_at,
        pickedAt: row.picked_at,
        deliveredAt: row.delivered_at,
        cancelledAt: row.cancelled_at,
    });
}

export async function createOrder(data: Partial<OrderEntity>, conn: Knex): Promise<OrderEntity> {
    const [row] = await conn("orders").insert({
        region: data.region,
        public_id: data.publicId,
        country_code: data.countryCode,
        restaurant_id: data.restaurantId,
        restaurant_owner_id: data.restaurantOwnerId,
        branch_id: data.branchId,
        customer_id: data.customerId,
        customer_address_id: data.customerAddressId,
        delivery_lat: data.deliveryLat,
        delivery_lng: data.deliveryLng,
        delivery_address_text_snapshot: data.deliveryAddressTextSnapshot,
        branch_lat: data.branchLat,
        branch_lng: data.branchLng,
        status: data.status,
        subtotal: data.subtotal,
        delivery_fee: data.deliveryFee,
        service_fee: data.serviceFee,
        total: data.total,
        commission: data.commission,
        currency: data.currency,
        payment_method: data.paymentMethod,
        created_at: data.createdAt || new Date(),
        updated_at: data.updatedAt || new Date(),
    }).returning(ORDER_COLUMNS);
    return toEntity(row);
}

export async function findOrderByPublicId(publicId: string, conn: Knex): Promise<OrderEntity | undefined> {
    const row = await conn("orders")
        .select(ORDER_COLUMNS)
        .where({public_id: publicId}).first();
    return row ? toEntity(row) : undefined;
}

export async function findOrdersByCustomer(customerId: string, start: Date, end: Date , pagination: PaginationParams, conn: Knex) {
    const query = conn("orders")
        .select(ORDER_COLUMNS as unknown as string[])
        .where("customer_id", customerId)
        .where("created_at", ">=", start)
        .where("created_at", "<", end);

    const rows = await applyCursorPagination(query, pagination);
    const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy);
    return {data: result.data.map(toEntity), meta: result.meta};
}

// export async function findOrdersByRestaurantBranch(
//     filter: ListRestaurantOrdersFilter,
//     pagination: PaginationParams,
//     extraFilters: FilterParams[],
//     conn: Knex,
// ): Promise<ListResult<OrderEntity>> {
//     let query = conn("orders")
//         .select(ORDER_COLUMNS as unknown as string[])
//         .where("restaurant_id", filter.restaurantId)
//         .where("branch_id", filter.branchId);
//
//     if (filter.status) query = query.where("status", filter.status);
//     if (filter.from) query = query.where("created_at", ">=", filter.from);
//     if (filter.to) query = query.where("created_at", "<", filter.to);
//
//     query = applyFilters(query, extraFilters);
//     const rows = await applyCursorPagination(query, pagination);
//     const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy);
//     return {data: result.data.map(toEntity), meta: result.meta};
// }


export async function findOrdersByBranch(branchId: number,pagination: PaginationParams, conn: Knex, status?: OrderStatus,from? : Date, to?: Date, filter?:FilterParams[] ) {
    let query = conn("orders")
        .select(ORDER_COLUMNS)
        .where("branch_id", branchId)

    if (status) query = query.where({status});
    if (from) query = query.where("created_at", ">=", from);
    if (to) query = query.where("created_at", "<", to);
    if(filter) query = applyFilters(query, filter);


    const rows = await applyCursorPagination(query, pagination);
    const result = buildPaginationResult(rows, pagination.limit, pagination.sortBy);
    return {data: result.data.map(toEntity), meta: result.meta};

}

export async function updateOrderStatus(
    publicId: string,
    status: OrderStatus,
    conn: Knex,
    timestampColumn?: string,
): Promise<OrderEntity> {
    const updateData: Record<string, unknown> = {
        status,
        updated_at: new Date(),
    };

    if (timestampColumn && timestampColumn !== "updated_at") {
        updateData[timestampColumn] = new Date();
    }

    const [row] = await conn("orders")
        .where({public_id: publicId})
        .update(updateData)
        .returning(ORDER_COLUMNS);
    return toEntity(row);
}

export async function assignDeliveryAgent(
    id: string,
    createdAt: Date,
    region: string,
    agentId: string,
    conn: Knex
): Promise<OrderEntity> {
    const [row] = await conn("orders")
        .where({id, created_at: createdAt, region})
        .update({
            delivery_agent_id: agentId,
            status: OrderStatus.ASSIGNED,
            assigned_at: new Date(),
            updated_at: new Date(),
        })
        .returning(ORDER_COLUMNS);
    return toEntity(row);
}

export async function clearDeliveryAgent(
    id: string,
    createdAt: Date,
    region: string,
    conn: Knex
): Promise<void> {
    await conn("orders")
        .where({id, created_at: createdAt, region})
        .update({
            delivery_agent_id: null,
            status: OrderStatus.READY,
            assigned_at: null,
            updated_at: new Date(),
        });
}

export async function findOrderById(
    id: string,
    createdAt: Date,
    region: string,
    conn: Knex = db(region)
): Promise<OrderEntity | undefined> {
    const row = await conn("orders")
        .select(ORDER_COLUMNS)
        .where({id, created_at: createdAt, region})
        .first();
    return row ? toEntity(row) : undefined;
}

export async function findOrdersByDeliveryAgent(agentId: number, statuses: OrderStatus[], limit: number,conn: Knex): Promise<OrderEntity[]> {
    const rows = await conn("orders")
        .select(ORDER_COLUMNS)
        .where({delivery_agent_id: agentId})
        .whereIn("status", statuses).orderBy("assigned_at", "desc")
        .limit(limit);


    return rows.map(toEntity);
}

export async function findRestaurantOwnerId(
    restaurantId: number,
    region: string,
    conn: Knex = db(region)
): Promise<number| undefined> {
    const row = await conn("orders")
        .select("restaurant_owner_id")
        .where({restaurant_id: restaurantId, region})
        .orderBy("created_at", "desc")
        .first();
    return row?.restaurant_owner_id ? Number(row.restaurant_owner_id) : undefined;
}

export async function findDeliveredOrdersByAgent(agentId: string, region: string, limit: number = 50, cursor?: string, conn: Knex = db(region)): Promise<OrderEntity[]> {
    let query = conn("orders")
        .select(ORDER_COLUMNS)
        .where({delivery_agent_id: agentId, region, status: OrderStatus.DELIVERED})
        .orderBy("delivered_at", "desc")
        .limit(limit);

    if (cursor) {
        query = query.where("delivered_at", "<", cursor);
    }

    const rows = await query;
    return rows.map(toEntity);
}

export async function findOrdersByStatus(
    region: string,
    statuses: OrderStatus[],
    conn: Knex = db(region)
): Promise<OrderEntity[]> {
    const rows = await conn("orders")
        .select(ORDER_COLUMNS)
        .where({region})
        .whereIn("status", statuses)
        .orderBy("created_at", "asc");
    return rows.map(toEntity);
}

export async function findReadyUnassigned(limit: number, conn: Knex): Promise<OrderEntity[]> {
    const rows = await conn("orders")
        .select(ORDER_COLUMNS)
        .where({status: OrderStatus.READY})
        .whereNull("delivery_agent_id")
        .orderBy("ready_at", "asc")
        .limit(limit);
    return rows.map(toEntity);
}

export async function claimReadyOrderForAgent(
    publicId: string,
    agentId: number,
    conn: Knex
): Promise<OrderEntity | null> {
    const [row] = await conn("orders")
        .where({public_id: publicId, status: OrderStatus.READY})
        .whereNull("delivery_agent_id")
        .update({
            delivery_agent_id: agentId,
            status: OrderStatus.ASSIGNED,
            assigned_at: new Date(),
            updated_at: new Date(),
        })
        .returning(ORDER_COLUMNS);
    return row ? toEntity(row) : null;
}
