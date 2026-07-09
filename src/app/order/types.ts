import {StatusActor} from "./enums";

export interface ActorContext {
    userId: number;
    role: string;
    restaurantId?: number;
    restaurantRole?: string;
    branchIds?: number[];
    // other auth context if needed
}

export interface ProductStockChangedPayload {
    branchId: number;
    productId: number;
    newStock?: number;
    isAvailable?: boolean;
}

export interface ProductPriceChangedPayload {
    branchId: number;
    productId: number;
    newPrice: number;
}

export interface BranchUpdatedPayload {
    branchId: number;
    name?: string;
    lat?: number;
    lng?: number;
}

export interface BranchDeactivatedPayload {
    branchId: number;
}


export interface BranchEventPayload {
    branchId: number;
}
export interface RestaurantSuspendedPayload {
    restaurantId: number;
}


export interface UnavailableItem {
    productId: number;
    requested: number;
    available: number;
}

export interface AssertTransitionContext {
    actor: StatusActor;
    reason?: string;
    /** required when actor === customer to enforce the cancel window */
    placedAt?: Date | null;
    acceptedAt?: Date | null;
}