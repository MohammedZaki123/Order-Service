---
name: API Contracts
description: Complete OpenAPI specification for Order Service endpoints - Orders, Payments, Delivery, and WebSocket
type: reference
---

# Order Service API Contracts

## Overview

This document defines all REST API endpoints and WebSocket events for the Order Service. All endpoints require JWT authentication (Bearer token) unless otherwise noted.

**Base URL**: `/api/v1`  
**Authentication**: JWT Bearer token in `Authorization` header  
**Response Format**: JSON  
**Error Format**: See [Error Responses](#error-responses)

---

## Authentication

### JWT Token Requirements

All requests must include a valid JWT token:

```
Authorization: Bearer <jwt_token>
```

**Token Claims**:
```json
{
  "sub": "user_uuid",
  "accountType": "CUSTOMER|RESTAURANT|DELIVERY_AGENT|ADMIN",
  "regionCode": "US|EU|APAC|LATAM",
  "iat": 1234567890,
  "exp": 1234571490,
  "iss": "core-service"
}
```

---

## Orders Module

### 1. Create Order

Creates a new order for a customer.

```http
POST /orders
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid>
```

#### Request Body

```typescript
{
  "restaurantId": "uuid",                    // Required: Must exist in core-service
  "items": [
    {
      "productId": "uuid",                   // Required: Product from restaurant menu
      "quantity": 2,                         // Required: > 0
      "price": "10.50"                       // Required: Decimal as string
    }
  ],
  "srcAccId": "uuid",                        // Optional: Customer ID (null for system orders)
  "currency": "USD",                         // Required: ISO 4217 code
  "paymentMethod": "KASHIER|COD",            // Required: Payment method
  "regionCode": "US",                        // Required: Shard region
  "deliveryAddress": {                       // Required: Delivery location
    "street": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zipCode": "94105",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "instructions": "Ring bell twice"        // Optional
  },
  "specialInstructions": "Extra spicy",      // Optional: Cooking/delivery notes
  "idempotencyKey": "uuid"                   // Optional: For deduplication
}
```

#### Response (201 Created)

```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PENDING",
  "totalAmount": 23.50,
  "currency": "USD",
  "items": [
    {
      "itemId": "550e8400-e29b-41d4-a716-446655440001",
      "productId": "550e8400-e29b-41d4-a716-446655440002",
      "quantity": 2,
      "pricePerUnit": 10.50,
      "subtotal": 21.00
    }
  ],
  "tax": 1.50,
  "platformFee": 1.00,
  "deliveryFee": 0,
  "createdAt": "2026-04-21T14:32:10Z",
  "updatedAt": "2026-04-21T14:32:10Z"
}
```

#### Error Responses

| Status | Code | Message |
|--------|------|---------|
| 400 | `VALIDATION_ERROR` | Invalid request (negative amount, missing fields) |
| 400 | `INVALID_REGION_CODE` | Region not supported |
| 404 | `RESTAURANT_NOT_FOUND` | Restaurant doesn't exist |
| 404 | `PRODUCT_NOT_FOUND` | Product not in restaurant menu |
| 409 | `DUPLICATE_ORDER` | Idempotency key already exists |
| 502 | `EXTERNAL_SERVICE_ERROR` | Core service unreachable |

#### Authorization

- `CUSTOMER` account type required
- Must match `regionCode` in token claims
- Can only create orders for themselves (srcAccId = current user)

---

### 2. Get Order by ID

Retrieves a single order with all items.

```http
GET /orders/{orderId}
Authorization: Bearer <token>
```

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `orderId` | UUID | Order ID |

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `regionCode` | string | from JWT | Shard region (validated against token) |

#### Response (200 OK)

```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "restaurantId": "550e8400-e29b-41d4-a716-446655440003",
  "restaurantName": "Pizza House",
  "status": "CONFIRMED",
  "totalAmount": 23.50,
  "currency": "USD",
  "items": [
    {
      "itemId": "550e8400-e29b-41d4-a716-446655440001",
      "productId": "550e8400-e29b-41d4-a716-446655440002",
      "productName": "Margherita Pizza",
      "quantity": 2,
      "pricePerUnit": 10.50,
      "subtotal": 21.00
    }
  ],
  "deliveryAddress": {
    "street": "123 Main St",
    "city": "San Francisco",
    "state": "CA",
    "zipCode": "94105"
  },
  "payment": {
    "status": "PENDING",
    "method": "KASHIER"
  },
  "delivery": {
    "status": "ASSIGNED",
    "agentId": "550e8400-e29b-41d4-a716-446655440004",
    "agentName": "John Doe"
  },
  "createdAt": "2026-04-21T14:32:10Z",
  "updatedAt": "2026-04-21T14:45:30Z"
}
```

#### Authorization

- Customer can only view their own orders
- Restaurant can view orders assigned to them
- Admin can view any order

---

### 3. List Orders for Customer

Retrieves paginated list of orders for authenticated customer.

```http
GET /orders
Authorization: Bearer <token>
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | Filter by status (PENDING, CONFIRMED, etc.) |
| `limit` | int | 20 | Page size (max 100) |
| `cursor` | string | - | Cursor for pagination (base64 encoded) |
| `sortBy` | string | `createdAt` | Sort field |
| `sortOrder` | string | `DESC` | ASC or DESC |

#### Response (200 OK)

```json
{
  "orders": [
    {
      "orderId": "uuid",
      "restaurantName": "Pizza House",
      "status": "CONFIRMED",
      "totalAmount": 23.50,
      "createdAt": "2026-04-21T14:32:10Z"
    }
  ],
  "pagination": {
    "cursor": "base64_encoded_cursor",
    "hasMore": true,
    "count": 20
  }
}
```

#### Authorization

- Customer retrieves their own orders
- Restaurant retrieves orders for their restaurant
- Admin retrieves all orders (with filters)

---

### 4. Update Order Status

Restaurant/Admin updates order status (state machine validation).

```http
PUT /orders/{orderId}/status
Content-Type: application/json
Authorization: Bearer <token>
```

#### Request Body

```json
{
  "status": "CONFIRMED|PREPARING|READY|PICKED_UP|DELIVERED|CANCELLED",
  "notes": "Order is being prepared"  // Optional
}
```

#### State Transitions (Validated)

```
PENDING → CONFIRMED → PREPARING → READY → PICKED_UP → DELIVERED
  ↓                                                      ↑
  └──────────────────── CANCELLED ─────────────────────┘
```

#### Response (200 OK)

```json
{
  "orderId": "uuid",
  "status": "PREPARING",
  "updatedAt": "2026-04-21T14:45:30Z"
}
```

#### Error Responses

| Status | Code | Message |
|--------|------|---------|
| 404 | `ORDER_NOT_FOUND` | Order doesn't exist |
| 409 | `INVALID_TRANSITION` | Status transition not allowed |
| 403 | `FORBIDDEN` | User not authorized to update |

#### Authorization

- Only restaurant owner/manager or admin can update
- State transitions validated against current status

---

### 5. Cancel Order

Cancels an order (only PENDING or CONFIRMED status).

```http
DELETE /orders/{orderId}
Authorization: Bearer <token>
```

#### Request Body

```json
{
  "reason": "Customer changed mind|Restaurant unavailable|Other",
  "notes": "Reason details"  // Optional
}
```

#### Response (200 OK)

```json
{
  "orderId": "uuid",
  "status": "CANCELLED",
  "cancellationReason": "Customer changed mind",
  "refundStatus": "PENDING|PROCESSED",
  "updatedAt": "2026-04-21T14:50:00Z"
}
```

#### Business Rules

- Only PENDING or CONFIRMED orders can be cancelled
- Payment refunds triggered automatically for online payments
- Delivery assignment cancelled if exists
- Event emitted for all parties (customer, restaurant, agent)

#### Authorization

- Customer can cancel own orders (PENDING only)
- Restaurant/Admin can cancel PENDING or CONFIRMED
- Cannot cancel after READY status

---

## Payments Module

### 1. Initiate Payment

Creates a Kashier payment session.

```http
POST /payments
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid>
```

#### Request Body

```json
{
  "orderId": "uuid",
  "paymentMethod": "KASHIER|COD",
  "regionCode": "US",
  "returnUrl": "https://app.quickbite.com/orders/success",
  "cancelUrl": "https://app.quickbite.com/orders/cancel",
  "idempotencyKey": "uuid"  // Optional
}
```

#### Response (201 Created)

```json
{
  "paymentId": "550e8400-e29b-41d4-a716-446655440000",
  "orderId": "550e8400-e29b-41d4-a716-446655440001",
  "kashierSessionUrl": "https://pay.kashier.io/session/abc123xyz",
  "status": "PENDING",
  "amount": 23.50,
  "currency": "USD",
  "createdAt": "2026-04-21T15:02:00Z"
}
```

#### Kashier Integration Details

**Session Creation Flow**:
1. Order validation (must exist and be PENDING)
2. Kashier API call: `POST https://api.kashier.io/v3/payment-sessions`
3. Response includes redirect URL (customer completes payment on Kashier)
4. Webhook callback on Kashier: POST `/payments/kashier-webhook`

**Kashier Request**:
```json
{
  "amount": 23.50,
  "currency": "USD",
  "orderId": "uuid",
  "description": "Order at Pizza House",
  "customer": {
    "id": "user_uuid",
    "email": "customer@example.com"
  },
  "redirectUrl": "https://app.quickbite.com/orders/success",
  "metadata": {
    "regionCode": "US",
    "restaurantId": "uuid"
  }
}
```

**Kashier Response**:
```json
{
  "id": "pay_session_xyz123",
  "sessionUrl": "https://pay.kashier.io/session/abc123",
  "status": "pending",
  "amount": 23.50,
  "currency": "USD"
}
```

#### Error Responses

| Status | Code | Message |
|--------|------|---------|
| 400 | `INVALID_ORDER` | Order not found or wrong status |
| 400 | `INVALID_AMOUNT` | Amount mismatch with order |
| 409 | `PAYMENT_EXISTS` | Payment already exists for order |
| 502 | `KASHIER_ERROR` | Kashier API error |

#### Authorization

- Only order customer can initiate payment
- Order must be in PENDING status

---

### 2. Kashier Webhook Handler

**Webhook Endpoint** (PUBLIC, signature-verified):

```http
POST /payments/kashier-webhook
Content-Type: application/json
X-Kashier-Signature: <hmac_sha256>
```

#### Webhook Payload

```json
{
  "id": "pay_session_xyz123",
  "orderId": "uuid",
  "status": "SUCCESS|FAILED|CANCELLED",
  "amount": 23.50,
  "currency": "USD",
  "transactionId": "txn_abc123",
  "timestamp": "2026-04-21T15:04:12Z"
}
```

#### Processing Logic

1. **Signature Verification**: HMAC-SHA256 with Kashier secret
2. **Idempotency Check**: Lock on `kashier_payment_id` to prevent duplicates
3. **Status Update**: Update payment status in DB (optimistic locking with version)
4. **Order Confirmation**: If SUCCESS, trigger `OrderService.confirmOrder()`
5. **Event Emission**: Publish `PAYMENT_UPDATED` event to WebSocket
6. **Response**: Always return `200 OK` (idempotent)

#### Response (200 OK)

```json
{
  "status": "processed",
  "message": "Webhook received"
}
```

#### Error Handling

| Scenario | Action |
|----------|--------|
| **Invalid Signature** | Return 400, log error |
| **Duplicate Webhook** | Return 200 (idempotent), skip processing |
| **Payment Not Found** | Return 200 (eventual consistency) |
| **DB Error** | Return 500, retry queue |

**Signature Verification**:
```typescript
// Pseudo-code
const payload = JSON.stringify(webhookBody);
const signature = hmacSha256(payload, kashierSecret);
if (signature !== requestHeader['x-kashier-signature']) {
  return 400;
}
```

---

### 3. Get Payment Status

Retrieves payment details.

```http
GET /payments/{paymentId}
Authorization: Bearer <token>
```

#### Response (200 OK)

```json
{
  "paymentId": "uuid",
  "orderId": "uuid",
  "status": "PENDING|SUCCESS|FAILED|CANCELLED",
  "method": "KASHIER",
  "amount": 23.50,
  "currency": "USD",
  "kashierPaymentId": "pay_xyz123",
  "transactionId": "txn_abc123",
  "failureReason": null,
  "processedAt": "2026-04-21T15:04:12Z",
  "createdAt": "2026-04-21T15:02:00Z"
}
```

#### Authorization

- Customer can view own payment
- Admin can view any payment

---

### 4. Refund Payment (Admin Only)

Initiates a refund for a paid order.

```http
POST /payments/{paymentId}/refund
Authorization: Bearer <token>
Content-Type: application/json
```

#### Request Body

```json
{
  "amount": 23.50,        // Optional: Partial refund
  "reason": "Customer requested|Order cancelled",
  "notes": "Refund reason"
}
```

#### Response (200 OK)

```json
{
  "refundId": "uuid",
  "paymentId": "uuid",
  "status": "PENDING|PROCESSED|FAILED",
  "amount": 23.50,
  "currency": "USD",
  "reason": "Customer requested",
  "createdAt": "2026-04-21T15:10:00Z"
}
```

#### Business Rules

- Only DELIVERED or CANCELLED orders can be refunded
- Refund amount ≤ payment amount
- Kashier integration required (async call with retry)

#### Authorization

- Admin only

---

## Delivery Module

### 1. Assign Delivery Agent

Assigns a delivery agent to an order (after payment confirmation).

```http
POST /delivery/assignments
Content-Type: application/json
Authorization: Bearer <token>
Idempotency-Key: <uuid>
```

#### Request Body

```json
{
  "orderId": "uuid",
  "deliveryAgentId": "uuid",  // Optional: Auto-assign if not provided
  "regionCode": "US"
}
```

#### Response (201 Created)

```json
{
  "assignmentId": "uuid",
  "orderId": "uuid",
  "deliveryAgentId": "uuid",
  "agentName": "John Doe",
  "agentPhone": "+1-555-0123",
  "status": "ASSIGNED",
  "estimatedDeliveryTime": "2026-04-21T15:35:00Z",
  "assignedAt": "2026-04-21T15:10:30Z"
}
```

#### Auto-Assignment Logic (if deliveryAgentId not provided)

1. Query available delivery agents in region
2. Filter by distance to restaurant (<5 km)
3. Rank by:
   - Active status
   - Current load (pending deliveries)
   - Acceptance rate (> 80%)
4. Assign to top-ranked agent
5. Notify agent via push notification

#### Error Responses

| Status | Code | Message |
|--------|------|---------|
| 404 | `ORDER_NOT_FOUND` | Order doesn't exist |
| 400 | `INVALID_ORDER_STATUS` | Order not READY |
| 404 | `AGENT_NOT_FOUND` | Delivery agent doesn't exist |
| 503 | `NO_AGENTS_AVAILABLE` | No available agents in region |

#### Authorization

- Restaurant/Admin can assign manually
- Auto-assignment triggered by order status change to READY

---

### 2. Update Delivery Status

Delivery agent updates delivery progress.

```http
PUT /delivery/assignments/{assignmentId}/status
Content-Type: application/json
Authorization: Bearer <token>
```

#### Request Body

```json
{
  "status": "ASSIGNED|PICKED_UP|IN_TRANSIT|DELIVERED|FAILED",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "notes": "Traffic delay"  // Optional
}
```

#### State Transitions (Validated)

```
ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED
                                         ↓
                                      FAILED
```

#### Response (200 OK)

```json
{
  "assignmentId": "uuid",
  "status": "PICKED_UP",
  "location": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "updatedAt": "2026-04-21T15:15:00Z"
}
```

#### Business Rules

- Agent location captured with each update (for tracking)
- Delivery time calculated: ASSIGNED → DELIVERED
- On DELIVERED: Update order status, trigger payment settlement
- On FAILED: Auto-assign next agent, notify customer

#### Authorization

- Only assigned delivery agent can update
- Admin can force status changes

---

### 3. Get Delivery Status

Retrieves real-time delivery information.

```http
GET /delivery/assignments/{assignmentId}
Authorization: Bearer <token>
```

#### Response (200 OK)

```json
{
  "assignmentId": "uuid",
  "orderId": "uuid",
  "deliveryAgentId": "uuid",
  "agentName": "John Doe",
  "agentPhone": "+1-555-0123",
  "agentLocation": {
    "latitude": 37.7800,
    "longitude": -122.4200,
    "accuracy": 10  // meters
  },
  "status": "IN_TRANSIT",
  "estimatedArrivalTime": "2026-04-21T15:25:00Z",
  "actualDeliveryTime": null,
  "distance": 1.2,  // km
  "duration": 420,  // seconds
  "route": {
    "start": { "lat": 37.7700, "lng": -122.4100 },
    "current": { "lat": 37.7800, "lng": -122.4200 },
    "destination": { "lat": 37.7750, "lng": -122.4150 }
  }
}
```

#### Real-Time Location Tracking

- Agent location updated every 30 seconds
- Available via WebSocket `delivery_location_updated` event
- ETA recalculated based on current traffic

#### Authorization

- Customer can view their order's delivery status
- Agent can view their own assignments
- Restaurant can view agents assigned to their orders
- Admin can view all

---

### 4. List Pending Deliveries (Admin)

```http
GET /delivery/pending
Authorization: Bearer <token>
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `regionCode` | string | - | Filter by region |
| `status` | string | - | ASSIGNED or IN_TRANSIT |
| `limit` | int | 50 | Page size |

#### Response (200 OK)

```json
{
  "assignments": [
    {
      "assignmentId": "uuid",
      "orderId": "uuid",
      "restaurantName": "Pizza House",
      "agentName": "John Doe",
      "status": "PICKED_UP",
      "assignedAt": "2026-04-21T15:10:30Z"
    }
  ],
  "totalCount": 342,
  "regionCounts": {
    "US": 150,
    "EU": 120,
    "APAC": 72
  }
}
```

#### Authorization

- Admin/Logistics team only

---

## WebSocket: Real-Time Updates

### Connection & Authentication

**Endpoint**: `ws://order-service/stream`

**Handshake**:
```javascript
const socket = io('ws://order-service', {
  auth: {
    token: 'Bearer <jwt_token>',
    regionCode: 'US'
  }
});
```

**Authentication Validation**:
1. Extract JWT from auth header
2. Verify signature and expiration
3. Extract `regionCode` from claims
4. Only emit events for user's region

### Events: Order Lifecycle

#### ORDER_CREATED (Published by Orders Service)

**Subscribers**: Customer, Restaurant, Admin

```javascript
socket.on('order_event', (event) => {
  if (event.eventType === 'ORDER_CREATED') {
    console.log(event);
  }
});
```

**Payload**:
```json
{
  "orderId": "uuid",
  "eventType": "ORDER_CREATED",
  "timestamp": "2026-04-21T14:32:10Z",
  "payload": {
    "restaurantId": "uuid",
    "restaurantName": "Pizza House",
    "status": "PENDING",
    "totalAmount": 23.50,
    "currency": "USD",
    "itemCount": 2,
    "estimatedTime": 30  // minutes
  }
}
```

#### ORDER_STATUS_CHANGED (Published by Orders Service)

**Subscribers**: Customer, Restaurant, Agent (if assigned)

```json
{
  "orderId": "uuid",
  "eventType": "ORDER_STATUS_CHANGED",
  "timestamp": "2026-04-21T14:45:30Z",
  "payload": {
    "previousStatus": "PENDING",
    "newStatus": "CONFIRMED",
    "updatedBy": "restaurant",
    "notes": "Order confirmed"
  }
}
```

#### PAYMENT_UPDATED (Published by Payments Service)

**Subscribers**: Customer, Restaurant, Admin

```json
{
  "orderId": "uuid",
  "eventType": "PAYMENT_UPDATED",
  "timestamp": "2026-04-21T15:04:12Z",
  "payload": {
    "paymentId": "uuid",
    "status": "SUCCESS",
    "amount": 23.50,
    "currency": "USD",
    "transactionId": "txn_abc123"
  }
}
```

#### DELIVERY_ASSIGNED (Published by Delivery Service)

**Subscribers**: Customer, Restaurant, Agent

```json
{
  "orderId": "uuid",
  "eventType": "DELIVERY_ASSIGNED",
  "timestamp": "2026-04-21T15:10:30Z",
  "payload": {
    "assignmentId": "uuid",
    "deliveryAgentId": "uuid",
    "agentName": "John Doe",
    "agentPhone": "+1-555-0123",
    "agentRating": 4.8,
    "estimatedArrival": "2026-04-21T15:35:00Z"
  }
}
```

#### DELIVERY_STATUS_UPDATED (Published by Delivery Service)

**Subscribers**: Customer, Restaurant, Admin

```json
{
  "orderId": "uuid",
  "eventType": "DELIVERY_STATUS_UPDATED",
  "timestamp": "2026-04-21T15:15:00Z",
  "payload": {
    "assignmentId": "uuid",
    "status": "PICKED_UP",
    "location": {
      "latitude": 37.7749,
      "longitude": -122.4194
    },
    "estimatedArrival": "2026-04-21T15:30:00Z"
  }
}
```

#### DELIVERY_LOCATION_UPDATED (Published by Delivery Service)

**Subscribers**: Customer, Restaurant (every 30s)

```json
{
  "orderId": "uuid",
  "eventType": "DELIVERY_LOCATION_UPDATED",
  "timestamp": "2026-04-21T15:20:00Z",
  "payload": {
    "location": {
      "latitude": 37.7800,
      "longitude": -122.4200,
      "accuracy": 10
    },
    "distanceRemaining": 0.8,  // km
    "estimatedArrival": "2026-04-21T15:28:00Z"
  }
}
```

#### ORDER_DELIVERED (Published by Delivery Service)

**Subscribers**: Customer, Restaurant, Admin

```json
{
  "orderId": "uuid",
  "eventType": "ORDER_DELIVERED",
  "timestamp": "2026-04-21T15:30:00Z",
  "payload": {
    "deliveryTime": 58,  // minutes
    "agentRating": 4.8,
    "deliveryProof": {
      "photo": "https://...",
      "signature": "base64_encoded"
    }
  }
}
```

### Client-Side Subscription

```typescript
socket.on('connect', () => {
  // Subscribe to specific order
  socket.emit('subscribe_order', {
    orderId: 'uuid',
    regionCode: 'US'
  });
});

socket.on('order_event', (event: OrderEvent) => {
  console.log(`Order ${event.orderId}: ${event.eventType}`);
  
  switch (event.eventType) {
    case 'ORDER_CREATED':
      // Update UI with order confirmation
      break;
    case 'PAYMENT_UPDATED':
      if (event.payload.status === 'SUCCESS') {
        // Show success, enable delivery tracking
      }
      break;
    case 'DELIVERY_LOCATION_UPDATED':
      // Update map with agent location
      updateMapLocation(event.payload.location);
      break;
    case 'ORDER_DELIVERED':
      // Show delivery confirmation, open rating dialog
      break;
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from real-time updates');
});
```

---

## Error Responses

### Standard Error Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {
      "field": "fieldName",
      "constraint": "constraintName",
      "value": "actualValue"
    },
    "traceId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Common Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `AUTHENTICATION_FAILED` | 401 | Invalid/expired JWT |
| `FORBIDDEN` | 403 | User not authorized |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | State conflict (e.g., duplicate key) |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `EXTERNAL_SERVICE_ERROR` | 502 | Core service or Kashier unavailable |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Example Error Response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid order: amount must be > 0",
    "details": {
      "field": "totalAmount",
      "constraint": "positive",
      "value": -10
    },
    "traceId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

---

## Rate Limiting

**Headers**:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1234567890
```

**Limits** (per region, per user):
- **Orders**: 100 requests/hour
- **Payments**: 10 requests/hour
- **Delivery**: 1000 requests/hour (agents)
- **WebSocket**: Connected sockets (no limit, server-side throttle at 30/s)

---

## Timeouts & Retry Policy

### Client Timeouts

| Endpoint | Timeout |
|----------|---------|
| Order creation | 5s |
| Payment initiation | 10s |
| List operations | 10s |
| WebSocket events | N/A (streaming) |

### Retry Policy

**Idempotent Endpoints** (`POST`, `PUT`):
- Retry on 5xx (auto-retry 2x with exponential backoff)
- Include `Idempotency-Key` header for safety

**Non-Idempotent** (`GET`, `DELETE`):
- No auto-retry (client responsibility)
- Safe to retry `GET` unlimited times

---

## Versioning

**Current API Version**: `v1`

**Backwards Compatibility**:
- New fields added to responses are backwards compatible
- Deprecated fields will be marked in documentation before removal
- Major version change (v2) if breaking changes required

**Version Header** (optional):
```
API-Version: 1.0.0
```

---

## Testing & Sandbox

### Sandbox Environment

**Base URL**: `https://sandbox-api.quickbite.com/api/v1`

**Test Credentials**:
- Customer: `test-customer-uuid`
- Restaurant: `test-restaurant-uuid`
- Agent: `test-agent-uuid`

**Kashier Sandbox** (for payment testing):
- Session URL: `https://sandbox.kashier.io/...`
- Test cards available in Kashier docs

---

*Last Updated: 2026-04-22*  
*Maintained By: QuickBite Platform Team*

