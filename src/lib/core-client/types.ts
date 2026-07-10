export interface CoreClientRequest {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    path: string;                       // e.g. "/api/internal/branches/123"
    body?: unknown;
    correlationId?: string;
    idempotencyKey?: string;
}

export interface CoreAgent {
    id: number;
    name: string;
    phone?: string;
}



export interface CoreCustomerAddress {
    id: number;
    userId: number;
    label: string;
    country: string;
    city: string;
    street: string;
    building: string;
    apartmentNumber: string;
    lat: number;
    lng: number;
}

export interface CoreEnvelope<T> {
    success: boolean;
    data: T;
}


export interface CoreBranchMetaData {
    id: number;
    restaurantId: number;
    restaurantStatus:string;
    restaurantOwnerId?: number;
    region: string;
    lat: number;
    lng: number;
    isActive: boolean;
    acceptOrders: boolean;
    deliveryFee: number;
    currency: string;
    commissionBps: number;
    addressText: string;
    name: string
}

export interface CoreBranchProduct {
    productId: number;
    name: string;
    imageUrl: string | null;
    price: number;
    stock: number;
    isAvailable: boolean;
}


export interface ReserveStockItem{
    productId: number;
    quantity: number;
}

export interface ReserveStockApplied {
    productId: number;
    newStock: number;
}

export interface ReserveStockResult {
    ok: true;
    applied: ReserveStockApplied[];
}

export interface RolePermissionsResponse {
    role: string;
    permissions: string[];
}

export interface CoreEnvelope<T> {
    success: boolean;
    data: T;
}

