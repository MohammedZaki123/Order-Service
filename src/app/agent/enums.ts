/** Agent-facing delivery step (mapped to order status transitions). */
export enum DeliveryAction {
    ACCEPTED = "accepted",
    REJECTED = "rejected",
    PICKED = "picked",
    DELIVERED = "delivered",
}
