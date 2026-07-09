import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {CreateOrderRequestDTO, UpdateOrderStatusRequestDTO} from "../dto/order.request.dto";
import {Server as IoServer} from "socket.io";
import {container} from "../../../lib/di/container";

import {OrderEntity} from "../entity/order.entity";
import {OrderItemEntity} from "../entity/order-item.entity";
import {Currency, OrderStatus, PaymentMethod, StatusActor} from "../enums";
import * as orderRepo from "../repository/order.repo";
import * as itemRepo from "../repository/order-item.repo";
import {db} from "../../../lib/knex/knex";
import {AppError} from "../../../lib/error/AppError";
import {logger} from "../../../lib/logger/logger";
import {
    OrderDetailsResponseDTO,
    OrderResponseDTO,
    OrderStatusResponseDTO,
    OrderSummaryResponseDTO
} from "../dto/order.response.dto";
import {getBranch, getBranchProducts, reserveStock, undoReserveStock} from "../../../lib/core-client/branch.client";
import {flattenAddress, getCustomerAddress} from "../../../lib/core-client/address.client";
import {
    BranchNotAcceptingOrdersError,
    OnlinePaymentNotAvailableError,
    OrderNotFoundError,
    outOfStockError
} from "../errors";
import {assertRegion} from "../../../lib/sharding/regions";
import {ICacheProvider} from "../../../pkg/cache/cache.interface";
import {ActorContext, AssertTransitionContext, UnavailableItem} from "../types";
import {OrderStatusService} from "./order-status.service";
import {PaymentService} from "../../payment/service/payment.service";
import {CoreDataCacheService} from "./core-data-cache.service";
import {env} from "../../../lib/config/env";
import {UnAuthorisedError} from "../../../lib/auth/errors";
import {CoreBranchProduct} from "../../../lib/core-client/types";
import {multiplyMinor, sumMinor} from "../../../pkg/utils/money";
import {randomUUID} from "node:crypto";
import {insertOutboxEvent} from "../../../lib/events/outbox.repo";
import {EVENT_TYPES} from "../../../lib/events/event-types";
import {FilterParams, PaginationParams} from "../../../lib/http/pagination/cursor-pagination";
import {countItemsByOrderIds} from "../repository/order-item.repo";


const RESTAURANT_ORDERS_CACHE_PREFIX =
    (region: string, branchId: number) => `${region}:GET:/api/restaurant/orders?branchId=${branchId}`;

const OUTBOX_EVENT_FOR_STATUS: Partial<Record<OrderStatus, string>> = {
    [OrderStatus.ACCEPTED]: EVENT_TYPES.ORDER_ACCEPTED,
    [OrderStatus.REJECTED]: EVENT_TYPES.ORDER_REJECTED,
    [OrderStatus.CANCELLED]: EVENT_TYPES.ORDER_CANCELLED,
};

@injectable()
export class OrderService {
    constructor(
         @inject(TOKENS.CacheProvider) private readonly cacheProvider: ICacheProvider,
         @inject(TOKENS.OrderStatusService) private readonly orderStatusService: OrderStatusService,
         @inject(TOKENS.PaymentService) private readonly paymentService: PaymentService,
         @inject(TOKENS.CoreDataCacheService) private readonly coreData: CoreDataCacheService
    ) {}

    private get io(): IoServer {
        return container.resolve<IoServer>(TOKENS.WsServer);
    }

    async placeOrder(actor: ActorContext, region: string, dto: CreateOrderRequestDTO, correlationId?: string): Promise<OrderResponseDTO> {
        // 1. Fetch Branch & Restaurant info
        const branch = await getBranch(dto.branchId, correlationId);
        if (!branch.isActive|| !branch.acceptOrders || branch.restaurantStatus !== "active") {
            throw BranchNotAcceptingOrdersError;
        }

        // This operation is a bit redundant given the above check of branch.acceptOrders, but we do this to leverage the caching layer in case of recent updates from core about order acceptance without having to wait for cache invalidation
        if(await this.coreData.isBranchRejectingOrders(dto.branchId)){
            throw BranchNotAcceptingOrdersError;
        }

        const resolvedRegion = assertRegion(region ?? branch.region);

        // Online gateway is enabled per-region (env-driven). Anything else falls
        // back to COD-only — fail fast before we touch stock.
        if (dto.paymentMethod === PaymentMethod.ONLINE && !env.payments.onlineRegions.has(resolvedRegion)) {
            throw OnlinePaymentNotAvailableError;
        }

        // 2. Fetch Customer Address & Verify proximity
        const address = await getCustomerAddress(dto.customerAddressId, correlationId);
        if (Number(address.userId) !== Number(actor.userId)) throw UnAuthorisedError;
        // TODO: Check the distance between branch and customer address using the lat lng and reject if it's beyond the branch's delivery radius. This is a bit tricky because we don't want to add latency to the order placement flow by calling an external service for distance calculation, so we might want to do a simple Haversine formula calculation here or use a geospatial library. For now, we'll assume all addresses are valid.
        // const distanceMeters = this.calculateDistance(address.lat, address.lng, branch.lat, branch.lng);
        // // Default max radius 5km
        // const maxRadius = 5000;
        // if (distanceMeters > maxRadius) {
        //     throw new AppError(`Customer address is out of delivery range (${Math.round(distanceMeters)}m > ${maxRadius}m)`, 400);
        // }

        // 3. Fetch Products & Verify Availability/Price (Per-product caching)
        const productIds = dto.items.map(i => i.productId);
        let branchProducts: CoreBranchProduct[] = [];
        branchProducts = await getBranchProducts(dto.branchId, productIds, correlationId);
        
        if (branchProducts.length !== productIds.length) {
            throw new AppError("One or more products not found in this branch", 400);
        }

        const productMap: Map<number , CoreBranchProduct> = new Map(branchProducts.map(p => [Number(p.productId), p]));
        const itemsToCreate: Partial<OrderItemEntity>[] = [];
        const unavailableItems: UnavailableItem[] = [];

        for (const item of dto.items) {
            const bp = productMap.get(item.productId);
            if (!bp || !bp.isAvailable || bp.stock < item.quantity) {
                unavailableItems.push({
                    productId: item.productId,
                    requested: item.quantity,
                    available: bp?.stock ?? 0,
                });
                continue;
            }
            const lineTotal = multiplyMinor( bp.price, item.quantity);
            itemsToCreate.push({
                region,
                productId: item.productId,
                quantity: item.quantity,
                unitPriceSnapshot: bp.price,
                nameSnapshot: bp.name,
                imageUrlSnapshot: bp.imageUrl,
                lineTotal,
            });
        }
        if (unavailableItems.length > 0)
            throw outOfStockError(unavailableItems);

       const subtotal = sumMinor(itemsToCreate.map((it) => it.lineTotal || 0));

       const publicId = randomUUID();
        // 4. Reserve Stock in Core (Atomic)
        await reserveStock
        (dto.branchId, dto.items.map(i => ({productId: i.productId, quantity: i.quantity})),publicId , correlationId);

        // 5. DB Transaction: Create Order & Items
        const SERVICE_FEE = 1000;
        const total = subtotal + branch.deliveryFee + SERVICE_FEE;
        const orderData: Partial<OrderEntity> = {
            region: resolvedRegion,
            publicId,
            countryCode: branch.region,
            restaurantId: branch.restaurantId,
            restaurantOwnerId: branch.restaurantOwnerId,
            branchId: branch.id,
            customerId: actor.userId,
            customerAddressId: dto.customerAddressId,
            deliveryLat: address.lat,
            deliveryLng: address.lng,
            branchLat: branch.lat,
            branchLng: branch.lng,
            // this is the customer address text not branch
            deliveryAddressTextSnapshot: flattenAddress(address),
            status: dto.paymentMethod === PaymentMethod.COD ? OrderStatus.PLACED : OrderStatus.PENDING_PAYMENT,
            subtotal,    
            deliveryFee: branch.deliveryFee,
            serviceFee: SERVICE_FEE,
            total,
            // commission: Math.floor((subtotal * branch.commissionBps) / 10000),
            currency: branch.currency as Currency,
            paymentMethod: dto.paymentMethod,
        };

        const conn = await db(resolvedRegion).transaction();
        let order: OrderEntity;
        let items: OrderItemEntity[];

        try {
            order = await orderRepo.createOrder(orderData, conn);
            items = await itemRepo.bulkInsertItems(itemsToCreate.map(l => ({
                region: resolvedRegion,
                orderId: order.id,
                productId: l.productId,
                quantity: l.quantity,
                unitPriceSnapshot: l.unitPriceSnapshot,
                nameSnapshot: l.nameSnapshot,
                imageUrlSnapshot: l.imageUrlSnapshot,
                lineTotal: l.lineTotal,
                orderCreatedAt: order.createdAt
            })), conn);


            // Transactional outbox — only COD lands as `placed` here.
            // ONLINE orders start as `pending_payment` and emit `order.placed`
            // from the Kashier webhook after capture (see kashier-webhook.service.ts).
            if (order.status === OrderStatus.PLACED) {
                await insertOutboxEvent(conn, {
                    aggregateType: "order",
                    aggregateId: order.publicId,
                    eventType: EVENT_TYPES.ORDER_PLACED,
                    payload: buildOrderPlacedPayload(order, items),
                });
            }

            // if (dto.paymentMethod === PaymentMethod.COD) {
            //     await transactionRepo.createTransaction(
            //         {
            //             region: resolvedRegion,
            //             orderId: Number(order.id),
            //             orderCreatedAt: order.createdAt,
            //             transactionType: TransactionType.COD_COLLECTION,
            //             method: TransactionMethod.COD,
            //             status: TransactionStatus.PENDING,
            //             amount: order.total,
            //             currency: order.currency,
            //             srcAccId: Number(actor),
            //             dstAccId: Number(branch.restaurantOwnerId),
            //         },
            //         conn
            //     );
            // }
            
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            logger.error("Failed to create order in DB", {err, correlationId});
            
            // Undo stock reservation
            try {
                await undoReserveStock(dto.branchId, dto.items.map(i => ({productId: i.productId, quantity: i.quantity})), undefined, correlationId);
            } catch (undoErr) {
                logger.error("releaseStock failed after order placement rollback", {undoErr, correlationId});
            }
            throw err;
        }



        let paymentData: { sessionId: string; providerSessionId: string ; redirectUrl: string; expiresAt: string} | undefined = undefined;

        if (dto.paymentMethod === PaymentMethod.ONLINE) {
            try {
                const sessionResult = await this.paymentService.initializePaymentSession(
                   order
                );
                
                paymentData = {
                    sessionId: sessionResult.sessionId,
                    providerSessionId: sessionResult.providerSessionId,
                    expiresAt: sessionResult.expiresAt,
                    redirectUrl: sessionResult.redirectUrl,
                };
            } catch (payErr) {
                logger.warn("payment init failed; voiding order", {publicId: order.publicId, error: (payErr as Error).message});

                // Rollback order to Cancelled due to payment session initialization failure
                await orderRepo.updateOrderStatus(order.publicId, OrderStatus.CANCELLED, conn, "cancelled_at");


                // Undo stock reservation
                try {
                    await undoReserveStock(dto.branchId, dto.items.map(i => ({productId: i.productId, quantity: i.quantity})), undefined, correlationId);
                } catch (undoErr) {
                    logger.error("Failed to undo stock reserve in core service during payment init rollback", {undoErr, correlationId});
                }

                throw payErr;
            }
        }

        // 6. Post-Order tasks
        await this.cacheProvider.del(RESTAURANT_ORDERS_CACHE_PREFIX(resolvedRegion, Number(branch.id)));
        if(dto.paymentMethod === PaymentMethod.COD) {
            this.io.to(`branch:${branch.id}`).emit("order.created", OrderSummaryResponseDTO.from(order, items.length))
        }

        return OrderResponseDTO.from(order, items, paymentData);
    }

    async getOrder(actor: ActorContext, publicId: string, region: string): Promise<OrderDetailsResponseDTO> {
        const conn = db(region);
        const order = await orderRepo.findOrderByPublicId(publicId, conn);
        if (!order) throw OrderNotFoundError;

        this.assertReadAccess(actor, order);
        const items = await itemRepo.findItemsByOrderIds([order.id], region);
        return OrderDetailsResponseDTO.from(order, items);
    }

    async listCustomerOrders(customerId: string, region: string, year: number, pagination: PaginationParams) {
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
        const conn = db(region);
        const result = await orderRepo.findOrdersByCustomer(customerId, yearStart, yearEnd, pagination, conn);
        const itemsCount = await countItemsByOrderIds(result.data.map((o) => o.id), conn);
        return {
            data: result.data.map((o) => OrderSummaryResponseDTO.from(o, itemsCount.get(o.id) ?? 0)),
            meta: result.meta,
        }
    }

    async listRestaurantOrders(branchId: number, region: string, status: OrderStatus, from : Date | undefined,to: Date | undefined,pagination: PaginationParams, filters?: FilterParams[]) {
        const conn = db(region);
        const result = await orderRepo.findOrdersByBranch(Number(branchId), pagination, conn, status, from, to, filters);
        const itemsCount = await countItemsByOrderIds(result.data.map((o) => o.id), conn);
        return {
            data: result.data.map((o) => { return OrderSummaryResponseDTO.from(o, itemsCount.get(o.id) ?? 0)}),
            meta: result.meta,
        };
    }

    // async listRestaurantOrders(
    //     region: string,
    //     restaurantId: number,
    //     branchId: number,
    //     status: OrderStatus | undefined,
    //     from: Date | undefined,
    //     to: Date | undefined,
    //     filters: FilterParams[],
    //     pagination: PaginationParams,
    // ) {
    //     const conn = db(region);
    //     const result = await findOrdersByRestaurantBranch(
    //         {restaurantId, branchId, status, from, to},
    //         pagination,
    //         filters,
    //         conn,
    //     );
    //     const counts = await countItemsByOrderIds(result.data.map((o) => o.id), conn);
    //     return {
    //         data: result.data.map((o) => OrderSummaryResponseDTO.from(o, counts.get(o.id) ?? 0)),
    //         meta: result.meta,
    //     };
    // }



    // async updateStatus(actor: ActorContext, region: string, publicId: string, body: UpdateOrderStatusRequestDTO): Promise<OrderStatusResponseDTO> {
    //     const conn = db(region);
    //     const order = await findOrderByPublicId(publicId, conn);
    //     if (!order) throw OrderNotFoundError;
    //
    //     const statusActor = this.resolveStatusActor(actor, order);
    //     const {stamp} = assertTransition(order.status, body.status, {
    //         actor: statusActor,
    //         reason: body.reason,
    //         placedAt: order.createdAt,
    //         acceptedAt: order.acceptedAt,
    //     });
    //
    //     const trx = await conn.transaction();
    //     let updated: OrderEntity;
    //     try {
    //         updated = await updateOrderStatus(order.publicId, body.status, stamp, trx);
    //
    //         // Transactional outbox — pick the matching event type for the
    //         // new status. Same trx as the status update so we can't publish
    //         // a state we then roll back.
    //         const eventType = OUTBOX_EVENT_FOR_STATUS[body.status];
    //         if (eventType) {
    //             await insertOutboxEvent(trx, {
    //                 aggregateType: "order",
    //                 aggregateId: updated.publicId,
    //                 eventType,
    //                 payload: buildOrderTransitionPayload(updated, body.reason, statusActor),
    //             });
    //         }
    //
    //         await trx.commit();
    //     } catch (err) {
    //         await trx.rollback();
    //         throw err;
    //     }
    //
    //     await this.invalidateBranchOrdersCache(region, order.branchId);
    //
    //     const payload = OrderStatusResponseDTO.from(updated);
    //     this.io.to(`customer:${updated.customerId}`).emit("order.status_changed", payload);
    //     this.io.to(`branch:${updated.branchId}`).emit("order.status_changed", payload);
    //
    //     return payload;
    // }
    // This method is only called by update method in order controller
    // TODO: change parameters of this method
    async updateStatus(actor: ActorContext, dto: UpdateOrderStatusRequestDTO, region: string, orderId: string): Promise<OrderStatusResponseDTO> {
        const conn = db(region);
        const order = await orderRepo.findOrderByPublicId(orderId, conn);
        if(!order)
            throw OrderNotFoundError;
        const statusActor = this.resolveStatusActor(actor, order);
        const ctx: AssertTransitionContext = {
            actor: statusActor,
            reason: dto.reason,
            placedAt: order.createdAt,
            acceptedAt: order.acceptedAt
        }


        const timestampColumn = this.orderStatusService.assertTransition(order.status, dto.status, ctx);
        const trx = await conn.transaction();
        // switch (nextStatus) {
        //     case OrderStatus.ACCEPTED: timestampColumn = "accepted_at"; break;
        //     case OrderStatus.REJECTED: timestampColumn = "rejected_at"; break;
        //     case OrderStatus.READY: timestampColumn = "ready_at"; break;
        //     case OrderStatus.ASSIGNED: timestampColumn = "assigned_at"; break;
        //     case OrderStatus.PICKED: timestampColumn = "picked_at"; break;
        //     case OrderStatus.DELIVERED: timestampColumn = "delivered_at"; break;
        //     case OrderStatus.CANCELLED: timestampColumn = "cancelled_at"; break;
        // }
        let updated = order;
        try {
        updated = await orderRepo.updateOrderStatus(
            order.publicId,
            dto.status,
            conn,
            timestampColumn?.stamp || undefined
        );


            const eventType = OUTBOX_EVENT_FOR_STATUS[updated.status];
            if (eventType) {
                await insertOutboxEvent(conn, {
                    aggregateType: "order",
                    aggregateId: updated.publicId,
                    eventType,
                    payload: buildOrderTransitionPayload(updated, ctx.reason, ctx.actor),
                });
            }
        await trx.commit();
         }catch(e){
            await trx.rollback();
            throw e;
        }
        // Invalidate branch orders cache
        await this.cacheProvider.del(RESTAURANT_ORDERS_CACHE_PREFIX(region, Number(order.branchId)));


        const payload =  OrderStatusResponseDTO.from(updated)
        this.io.to(`customer:${order.customerId}`).emit("order.status_changed", payload);
        this.io.to(`branch:${order.branchId}`).emit("order.status_changed", payload);

        return payload;
    }


    private assertReadAccess(actor: ActorContext, order: OrderEntity) {
        if (actor.role === "system_admin") return;
        if (Number(actor.userId) === Number(order.customerId)) return;

        if (actor.role === "restaurant_user") {
            if (Number(actor.restaurantId) !== Number(order.restaurantId)) throw UnAuthorisedError;
            if (actor.restaurantRole === "owner") return;
            const branchIds = actor.branchIds ?? [];
            if (branchIds.includes(Number(order.branchId))) return;
        }
        throw UnAuthorisedError;
    }

    private resolveStatusActor(actor: ActorContext, order: OrderEntity): StatusActor {
        if (actor.role === "system_admin") return StatusActor.ADMIN;
        if (actor.role === "delivery_agent" && Number(actor.userId) === Number(order.deliveryAgentId)) return StatusActor.AGENT;
        if (actor.role === "restaurant_user") {
            if (Number(actor.restaurantId) !== Number(order.restaurantId))
                throw UnAuthorisedError;
            if (actor.restaurantRole !== "owner") {
                const branchIds = actor.branchIds ?? [];
                if (!branchIds.includes(Number(order.branchId))) throw UnAuthorisedError;
            }
            return StatusActor.RESTAURANT_MEMBER;
        }
        if (Number(actor.userId) === Number(order.customerId)) return StatusActor.CUSTOMER;
        throw UnAuthorisedError;
    }

    // private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    //     const R = 6371e3; // metres
    //     const φ1 = lat1 * Math.PI / 180;
    //     const φ2 = lat2 * Math.PI / 180;
    //     const Δφ = (lat2 - lat1) * Math.PI / 180;
    //     const Δλ = (lon2 - lon1) * Math.PI / 180;

    //     const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    //         Math.cos(φ1) * Math.cos(φ2) *
    //         Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    //     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    //     return R * c; // in metres
    // }
}


/** Matches analytics-service contract (docs/api-contracts.md — order.placed payload). */
function buildOrderPlacedPayload(order: OrderEntity, items: OrderItemEntity[]) {
    return {
        orderId: order.publicId,
        region: order.region,
        countryCode: order.countryCode,
        restaurantId: Number(order.restaurantId),
        branchId: Number(order.branchId),
        customerId: Number(order.customerId),
        status: order.status,
        paymentMethod: order.paymentMethod,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        serviceFee: order.serviceFee,
        total: order.total,
        currency: order.currency,
        items: items.map((i) => ({
            productId: Number(i.productId),
            quantity: i.quantity,
            unitPrice: i.unitPriceSnapshot,
            lineTotal: i.lineTotal,
        })),
        placedAt: order.createdAt.toISOString(),
    };
}

function buildOrderTransitionPayload(order: OrderEntity, reason: string | undefined, actor: StatusActor) {
    return {
        orderId: order.publicId,
        region: order.region,
        restaurantId: Number(order.restaurantId),
        branchId: Number(order.branchId),
        customerId: Number(order.customerId),
        status: order.status,
        reason: reason ?? null,
        actor,
        occurredAt: order.updatedAt.toISOString(),
    };
}

