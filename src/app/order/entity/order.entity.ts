import {Currency, OrderStatus, PaymentMethod} from "../enums";

export class OrderEntity {
    id!: number; // Internal BIGINT
    region!: string;
    publicId!: string; // UUID
    countryCode!: string;
    restaurantId!: number;
    branchId!: number;
    customerId!: number;
    customerAddressId!: number;
    deliveryLat!: number;
    deliveryLng!: number;
    deliveryAddressTextSnapshot!: string;
    restaurantOwnerId!: number;
    branchLat!: number;
    branchLng!: number;

    status!: OrderStatus;
    subtotal!: number;
    deliveryFee!: number;
    serviceFee!: number;
    total!: number;
    commission!: number;
    currency!: Currency;
    paymentMethod!: PaymentMethod;
    deliveryAgentId?: number | null;
    createdAt!: Date;
    updatedAt!: Date;
    acceptedAt?: Date | null;
    rejectedAt?: Date | null;
    readyAt?: Date | null;
    assignedAt?: Date | null;
    pickedAt?: Date | null;
    deliveredAt?: Date | null;
    cancelledAt?: Date | null;

    constructor(data: Partial<OrderEntity>) {
       Object.assign(this,data)
    }
}
