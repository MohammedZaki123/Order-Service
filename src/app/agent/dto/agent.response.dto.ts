import {AgentEarningEntity} from "../entity/agent-earning.entity";
import {OrderEntity} from "../../order/entity/order.entity";
import {OrderItemEntity} from "../../order/entity/order-item.entity";
import {Currency, OrderStatus} from "../../order/enums";

export class DeliveryTaskResponseDTO {
    orderPublicId!: string;
    status!: OrderStatus;
    pickup!: {branchId: number, branchName: string|null; lat: number|null; lng: number|null; addressText: string|null};
    dropoff!: {lat: number; lng: number; addressText: string};
    total!: number;
    currency!: Currency;
    paymentMethod!: string;
    assignedAt!: string;
    pickedAt!: string | null;
    deliveredAt!: string | null;

    static from(
        order: OrderEntity,
        branch?: {lat: number; lng: number; name: string; addressText: string},
    ): DeliveryTaskResponseDTO {
        const dto = new DeliveryTaskResponseDTO();
        dto.orderPublicId = order.publicId;
        dto.status = order.status;
        dto.pickup = {
            branchId: order.branchId,
            branchName: branch?.name ?? null,
            lat: branch?.lat ?? null,
            lng: branch?.lng ?? null,
            addressText: branch?.addressText ?? null,
        };
        dto.dropoff = {
            lat: order.deliveryLat,
            lng: order.deliveryLng,
            addressText: order.deliveryAddressTextSnapshot,
        };
        dto.total = order.total;
        dto.currency = order.currency;
        dto.paymentMethod = order.paymentMethod;
        dto.assignedAt = (order.assignedAt ?? order.createdAt).toISOString();
        dto.pickedAt = order.pickedAt?.toISOString() ?? null;
        dto.deliveredAt = order.deliveredAt?.toISOString() ?? null;
        return dto;
    }
}

export class AgentEarningsResponseDTO {
    range!: {from: string; to: string};
    totals!: {count: number; sum: number; currency: string | null};
    items!: AgentEarningItemDTO[];

    static from(
        from: Date,
        to: Date,
        items: AgentEarningEntity[],
        sum: number,
    ): AgentEarningsResponseDTO {
        const dto = new AgentEarningsResponseDTO();
        dto.range = {from: from.toISOString(), to: to.toISOString()};
        dto.totals = {
            count: items.length,
            sum,
            currency: items[0]?.currency ?? null,
        };
        dto.items = items.map(AgentEarningItemDTO.from);
        return dto;
    }
}


export class AgentEarningItemDTO {
    orderId!: number;
    amount!: number;
    currency!: string;
    earnedAt!: string;

    static from(e: AgentEarningEntity): AgentEarningItemDTO {
        const dto = new AgentEarningItemDTO();
        dto.orderId = e.orderId;
        dto.amount = e.amount;
        dto.currency = e.currency;
        dto.earnedAt = e.earnedAt.toISOString();
        return dto;
    }
}