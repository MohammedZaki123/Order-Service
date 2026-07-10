import {OrderEntity} from "../../order/entity/order.entity";

export class DeliveryAssignResponseDTO {
    orderPublicId!: string;
    agent!: {id: number; name?: string; phone?: string};
    status!: string;
    pickup!: {lat: number; lng: number};
    dropoff!: {lat: number; lng: number};
    assignedAt!: string;

    static from(order: OrderEntity, agentId: string): DeliveryAssignResponseDTO {
        const dto = new DeliveryAssignResponseDTO();
        dto.orderPublicId = order.publicId;
        dto.agent = {id: Number(agentId)};
        dto.status = order.status;
        dto.pickup = {lat: order.branchLat, lng: order.branchLng};
        dto.dropoff = {lat: order.deliveryLat, lng: order.deliveryLng};
        dto.assignedAt = (order.assignedAt ?? new Date()).toISOString();
        return dto;
    }
}
