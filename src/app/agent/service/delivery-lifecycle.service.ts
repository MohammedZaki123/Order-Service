import {inject, injectable} from "tsyringe";
import {Server} from "socket.io";
import {TOKENS} from "../../../lib/di/tokens";
import {AppError} from "../../../lib/error/AppError";
import {db} from "../../../lib/knex/knex";
import {OrderStatus} from "../../order/enums";
import * as orderRepo from "../../order/repository/order.repo";
import {Server as IoServer} from "socket.io";
import {container} from "../../../lib/di/container";
import {PresenceService} from "./presence.service";
import {SettlementService} from "../../finance/service/settlement.service";
import {AssignmentService} from "../../assignment/service/assignment.service";
import {DeliveryAction} from "../enums";
import {logger} from "../../../lib/logger/logger";
import {OrderEntity} from "../../order/entity/order.entity";
import {ICacheProvider} from "../../../pkg/cache/cache.interface";

@injectable()
export class DeliveryLifecycleService {
    constructor(
        @inject(TOKENS.PresenceService) private readonly presenceService: PresenceService,
        @inject(TOKENS.SettlementService) private readonly settlementService: SettlementService,
        @inject(TOKENS.AssignmentService) private readonly assignmentService: AssignmentService,
        @inject(TOKENS.CacheProvider) private readonly cacheProvider: ICacheProvider
    ) {}

    private get io(): IoServer {
        return container.resolve<IoServer>(TOKENS.WsServer);
    }

    async updateStatus(
        orderPublicId: string,
        agentId: number,
        region: string,
        action: DeliveryAction,
    ): Promise<OrderEntity> {
        const conn = db(region);
        const order = await orderRepo.findOrderByPublicId(orderPublicId, conn);
        if (!order) {
            throw new AppError("Order not found", 404);
        }
        if (order.deliveryAgentId !== Number(agentId)) {
            throw new AppError("This order is not assigned to you", 403);
        }

        switch (action) {
            // case DeliveryAction.ACCEPTED:
            //     return this.accept(order, agentId, region);
            // case DeliveryAction.REJECTED:
            //     return this.reject(order, agentId, region, reason);
            case DeliveryAction.PICKED:
                return this.pickup(order, agentId, region);
            case DeliveryAction.DELIVERED:
                return this.deliver(order, agentId, region);
            default:
                throw new AppError("Invalid delivery action", 400);
        }
    }

    async updatePosition(
        orderPublicId: string,
        agentId: number,
        region: string,
        lat: number,
        lng: number
    ): Promise<void> {
        const order = await orderRepo.findOrderByPublicId(orderPublicId, db(region));
        if (!order) {
            throw new AppError("Order not found", 404);
        }
        if (order.deliveryAgentId !== agentId) {
            throw new AppError("This order is not assigned to you", 403);
        }
        this.emitPosition(order, lat, lng);
    }

    // /** On presence ping, fan out location to customers with an active delivery from this agent. */
    // async emitPositionForActiveTask(
    //     agentId: number,
    //     region: string,
    //     lat: number,
    //     lng: number
    // ): Promise<void> {
    //     const conn = db(region);
    //     const active = await orderRepo.findOrdersByDeliveryAgent(agentId, [
    //         OrderStatus.ASSIGNED,
    //         OrderStatus.PICKED,
    //     ], conn);
    //     if (active) {
    //         this.emitPosition(active, lat, lng);
    //     }
    // }

    private emitPosition(order: OrderEntity, lat: number, lng: number): void {
        this.io.to(`customer:${order.customerId}`).emit("delivery.position", {
            orderId: order.publicId,
            lat,
            lng,
            ts: new Date().toISOString(),
        });
    }

    private async accept(order: OrderEntity, agentId: number, region: string): Promise<OrderEntity> {
        if (order.status !== OrderStatus.ASSIGNED) {
            throw new AppError(`Order must be ASSIGNED to accept (current: ${order.status})`, 409);
        }
        await this.presenceService.markBusy(agentId, region);
        this.emitDeliveryStatus(order, OrderStatus.ASSIGNED);
        logger.info("Delivery accepted by agent", {orderId: order.publicId, agentId});
        return order;
    }

    private async reject(
        order: OrderEntity,
        agentId: number,
        region: string,
        reason?: string
    ): Promise<OrderEntity> {
        if (order.status !== OrderStatus.ASSIGNED) {
            throw new AppError(`Order must be ASSIGNED to reject (current: ${order.status})`, 409);
        }
        const conn = db(region);
        const trx = await conn.transaction();
        try {
            await orderRepo.clearDeliveryAgent(String(order.id), order.createdAt, region, trx);
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            throw err;
        }
        await this.presenceService.markFree(agentId, region);
        this.io.to(`agent:${agentId}`).emit("task.cancelled", {
            orderId: order.publicId,
            reason: reason ?? "rejected",
        });
        void this.assignmentService.tryAssign(order, region).catch((err) => {
            logger.warn("Reassignment after reject failed", {
                orderId: order.publicId,
                error: err instanceof Error ? err.message : String(err),
            });
        });
        return order;
    }

    private async pickup(order: OrderEntity, agentId: number, region: string): Promise<OrderEntity> {
        if (order.status !== OrderStatus.ASSIGNED) {
            throw new AppError(`Order must be ASSIGNED to pick up (current: ${order.status})`, 409);
        }
        const updated = await orderRepo.updateOrderStatus(
           order.publicId,
            OrderStatus.PICKED,
            db(region),
            "picked_at"
        );
        this.emitDeliveryStatus(updated, OrderStatus.PICKED);
        logger.info("Order picked up", {orderId: order.publicId, agentId});
        return updated;
    }

    private async deliver(order: OrderEntity, agentId: number, region: string): Promise<OrderEntity> {
        if (order.status !== OrderStatus.PICKED) {
            throw new AppError(`Order must be PICKED to deliver (current: ${order.status})`, 409);
        }

        const conn = db(region);
        const trx = await conn.transaction();
        try {
            const updated = await orderRepo.updateOrderStatus(
                order.publicId,
                OrderStatus.DELIVERED,
                trx,
                "delivered_at"
            );
            await this.settlementService.settleDeliveredOrder(updated, agentId, trx);
            await trx.commit();

            await this.presenceService.markFree(agentId, region);
            this.emitDeliveryStatus(updated, OrderStatus.DELIVERED);
            await this.cacheProvider.del(AssignmentService.claimKey(order.publicId));
            logger.info("Order delivered", {orderId: order.publicId, agentId});
            return updated;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    private emitDeliveryStatus(order: OrderEntity, status: OrderStatus): void {
        const payload = {
            orderId: order.publicId,
            status,
            ts: new Date().toISOString(),
            agent: order.deliveryAgentId
                ? {id: Number(order.deliveryAgentId)}
                : undefined,
        };
        this.io.to(`customer:${order.customerId}`).emit("delivery.status_changed", payload);
        this.io.to(`branch:${order.branchId}`).emit("delivery.status_changed", payload);
    }
}
