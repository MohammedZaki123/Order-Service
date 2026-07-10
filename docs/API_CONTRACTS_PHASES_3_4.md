# Order Service API Contracts — Phases 3 & 4

Complete specification of all endpoints related to delivery assignment, agent management, and restaurant finance.

---

## A. Delivery Assignment Endpoints

### A.1 Manual Assignment (Staff/Manager)

**Endpoint**: `POST /restaurant/{restaurantId}/branch/{branchId}/deliveries/assign/{orderId}`

**Authentication**: JWT token (must have `deliveries:assign` permission)

**Path Parameters**:
- `restaurantId`: Restaurant ID
- `branchId`: Branch ID
- `orderId`: Order public ID (UUID)

**Request Body**:
```json
{
  "agentId": 123  // Optional. If not provided, auto-select nearest agent
}
```

**Response** (201 Created):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "assigned",
  "agent": {
    "id": 123,
    "name": "John Delivery",
    "phone": "+201234567890"
  },
  "estimatedDeliveryTime": "2026-05-26T14:30:00Z",
  "assignedAt": "2026-05-26T14:15:00Z"
}
```

**Errors**:
- `404` - Order not found
- `400` - Order not in READY status, or agent not online
- `409` - Order already assigned
- `403` - Forbidden (RBAC check failed)

---

### A.2 Reassign (After Rejection)

**Endpoint**: `POST /restaurant/{restaurantId}/branch/{branchId}/deliveries/reassign/{orderId}`

**Authentication**: JWT token (must have `deliveries:assign` permission)

**Response** (201 Created):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "assigned",
  "agent": {
    "id": 124,
    "name": "Jane Delivery",
    "phone": "+201234567891"
  },
  "reassignmentAttempt": 1,
  "maxReassignmentAttempts": 3
}
```

**Errors**:
- `409` - Max reassignment attempts exceeded
- `400` - No eligible agents available

---

## B. Agent Endpoints

### B.1 Agent Presence — Online

**Endpoint**: `POST /agents/presence/online`

**Authentication**: JWT token (agent user)

**Request Body**:
```json
{
  "lat": 30.0444,
  "lng": 31.2357,
  "city": "Cairo"
}
```

**Response** (200 OK):
```json
{
  "agentId": 123,
  "status": "online",
  "location": {
    "lat": 30.0444,
    "lng": 31.2357
  },
  "expiresAt": "2026-05-26T14:20:00Z"
}
```

---

### B.2 Agent Presence — Ping (Keep Alive)

**Endpoint**: `POST /agents/presence/ping`

**Authentication**: JWT token (agent user)

**Request Body**:
```json
{
  "lat": 30.0444,
  "lng": 31.2357
}
```

**Response** (200 OK):
```json
{
  "agentId": 123,
  "status": "online",
  "location": {
    "lat": 30.0444,
    "lng": 31.2357
  },
  "expiresAt": "2026-05-26T14:25:00Z"
}
```

**Note**: Should be called every 5 minutes to maintain online status in Redis.

---

### B.3 Agent Presence — Offline

**Endpoint**: `POST /agents/presence/offline`

**Authentication**: JWT token (agent user)

**Response** (200 OK):
```json
{
  "agentId": 123,
  "status": "offline"
}
```

---

### B.4 Agent Task List

**Endpoint**: `GET /agents/tasks?status=assigned,picked`

**Authentication**: JWT token (agent user)

**Query Parameters**:
- `status` - Filter by status (assigned, picked, delivered)
- `limit` - Page size (default 20)
- `cursor` - Pagination cursor

**Response** (200 OK):
```json
{
  "data": [
    {
      "orderId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "assigned",
      "restaurant": {
        "name": "Pizza Palace",
        "branchName": "Downtown"
      },
      "customer": {
        "name": "Ahmed Hassan",
        "phone": "+201234567890"
      },
      "items": 3,
      "deliveryFee": 25.00,
      "estimatedEarning": 17.50,
      "location": {
        "lat": 30.0444,
        "lng": 31.2357,
        "address": "123 Main St, Cairo"
      },
      "assignedAt": "2026-05-26T14:15:00Z"
    }
  ],
  "pagination": {
    "nextCursor": "cur_abc123",
    "hasMore": true
  }
}
```

---

### B.5 Agent Earnings History

**Endpoint**: `GET /agents/earnings?from=2026-05-01&to=2026-05-31&limit=50&cursor=`

**Authentication**: JWT token (agent user)

**Query Parameters**:
- `from` - Start date (ISO 8601)
- `to` - End date (ISO 8601)
- `limit` - Page size (default 50)
- `cursor` - Pagination cursor

**Response** (200 OK):
```json
{
  "data": [
    {
      "earningId": "earn_123",
      "orderId": "550e8400-e29b-41d4-a716-446655440000",
      "amount": 17.50,
      "currency": "EGP",
      "earnedAt": "2026-05-26T14:45:00Z"
    }
  ],
  "totalEarnings": 250.00,
  "pagination": {
    "nextCursor": "cur_abc123",
    "hasMore": false
  }
}
```

---

### B.6 Update Delivery Status

**Endpoint**: `PATCH /orders/{orderId}/delivery/status`

**Authentication**: JWT token (agent user)

**Request Body**:
```json
{
  "action": "accepted" | "rejected" | "picked" | "delivered",
  "reason": "optional rejection reason"
}
```

**Response** (200 OK):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "picked",
  "updatedAt": "2026-05-26T14:45:00Z"
}
```

**Transitions**:
- `assigned` → `accepted` (agent accepts)
- `assigned` → `rejected` (agent rejects, triggers reassignment)
- `assigned` → `picked` (agent picks up)
- `picked` → `delivered` (agent delivers)

---

### B.7 Update Delivery Position

**Endpoint**: `POST /orders/{orderId}/delivery/position`

**Authentication**: JWT token (agent user)

**Request Body**:
```json
{
  "lat": 30.0544,
  "lng": 31.2457
}
```

**Response** (200 OK):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "position": {
    "lat": 30.0544,
    "lng": 31.2457
  },
  "updatedAt": "2026-05-26T14:45:30Z"
}
```

**Note**: Broadcasted to customer via WebSocket in real-time.

---

## C. Restaurant Finance Endpoints

### C.1 Get Balance

**Endpoint**: `GET /restaurant/{restaurantId}/finance/balance`

**Authentication**: JWT token (must have `finance:read` permission)

**Path Parameters**:
- `restaurantId`: Restaurant ID

**Response** (200 OK):
```json
{
  "restaurantId": "rest_123",
  "balance": 5234.67,
  "currency": "EGP",
  "updatedAt": "2026-05-26T14:45:00Z",
  "summary": {
    "totalDeliveries": 145,
    "totalCommission": 1265.43,
    "totalPayouts": 2000.00
  }
}
```

**Errors**:
- `403` - Forbidden (RBAC check failed)
- `404` - Restaurant not found

---

### C.2 List Payouts

**Endpoint**: `GET /restaurant/{restaurantId}/finance/payouts?from=2026-05-01&to=2026-05-31&limit=50`

**Authentication**: JWT token (must have `finance:read` permission)

**Query Parameters**:
- `from` - Start date (ISO 8601, default 90 days ago)
- `to` - End date (ISO 8601, default today)
- `limit` - Page size (default 50)
- `cursor` - Pagination cursor

**Response** (200 OK):
```json
{
  "data": [
    {
      "payoutId": "payout_123",
      "amount": 2000.00,
      "currency": "EGP",
      "status": "succeeded",
      "createdAt": "2026-05-20T10:00:00Z",
      "processedAt": "2026-05-20T10:05:00Z",
      "providerReference": "bank_ref_12345"
    }
  ],
  "pagination": {
    "nextCursor": "cur_abc123",
    "hasMore": true
  }
}
```

---

### C.3 Record Payout

**Endpoint**: `POST /restaurant/{restaurantId}/finance/payouts`

**Authentication**: JWT token (must have `finance:payout_create` permission — system_admin only)

**Headers**:
- `Idempotency-Key`: Unique key for idempotency (required)

**Request Body**:
```json
{
  "amount": 2000.00,
  "currency": "EGP",
  "providerReferenceId": "bank_ref_12345",
  "note": "Monthly payout"
}
```

**Response** (201 Created):
```json
{
  "payoutId": "payout_124",
  "restaurantId": "rest_123",
  "amount": 2000.00,
  "currency": "EGP",
  "status": "succeeded",
  "balanceAfter": 3234.67,
  "createdAt": "2026-05-26T14:45:00Z",
  "providerReference": "bank_ref_12345"
}
```

**Errors**:
- `400` - Missing Idempotency-Key header
- `403` - Forbidden (must be system_admin)
- `409` - Insufficient balance

---

## D. Order Management (Updated for Phase 3/4)

### D.1 List Restaurant Orders

**Endpoint**: `GET /restaurant/{restaurantId}/branch/{branchId}/orders?status=&cursor=&limit=`

**Authentication**: JWT token (must have `orders:read` permission)

**Query Parameters**:
- `status` - Filter by status (placed, accepted, preparing, ready, assigned, picked, delivered, etc.)
- `limit` - Page size (default 20)
- `cursor` - Pagination cursor

**Response** (200 OK):
```json
{
  "data": [
    {
      "orderId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "picked",
      "customerName": "Ahmed Hassan",
      "items": 3,
      "total": 125.50,
      "currency": "EGP",
      "deliveryAgent": {
        "id": 123,
        "name": "John Delivery",
        "phone": "+201234567890"
      },
      "createdAt": "2026-05-26T14:15:00Z",
      "readyAt": "2026-05-26T14:30:00Z",
      "pickedAt": "2026-05-26T14:40:00Z"
    }
  ],
  "pagination": {
    "nextCursor": "cur_abc123",
    "hasMore": true
  }
}
```

---

### D.2 Update Order Status

**Endpoint**: `PATCH /restaurant/{restaurantId}/branch/{branchId}/orders/{orderId}/status`

**Authentication**: JWT token (must have `orders:update` permission)

**Headers**:
- `Idempotency-Key`: Unique key for idempotency (required)

**Request Body**:
```json
{
  "status": "accepted" | "rejected" | "preparing" | "ready" | "cancelled",
  "reason": "optional rejection/cancellation reason"
}
```

**Response** (200 OK):
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ready",
  "updatedAt": "2026-05-26T14:30:00Z",
  "readyAt": "2026-05-26T14:30:00Z"
}
```

**Valid Transitions**:
- `placed` → `accepted` (restaurant accepts)
- `placed` → `rejected` (restaurant rejects)
- `accepted` → `preparing`
- `preparing` → `ready` (triggers auto-assignment)
- Any status → `cancelled`

---

## E. WebSocket Events

### E.1 Agent Channel: `agent:{agentId}`

**Server → Agent Events**:

```typescript
// New order offer broadcast
{
  event: "order.assignment_offered",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    branchId: 42,
    restaurantId: 1,
    subtotal: 125.50,
    deliveryFee: 25.00,
    currency: "EGP",
    customerLocation: { lat: 30.0444, lng: 31.2357 },
    acceptTimeoutSec: 30,
    ts: "2026-05-26T14:15:00Z"
  }
}

// Assignment confirmed
{
  event: "task.assigned",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    status: "assigned",
    branchName: "Downtown",
    items: 3,
    estimatedEarning: 17.50,
    ts: "2026-05-26T14:15:00Z"
  }
}

// Assignment cancelled/expired
{
  event: "task.cancelled",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    reason: "rejected" | "expired" | "reassigned",
    ts: "2026-05-26T14:15:00Z"
  }
}
```

---

### E.2 Customer Channel: `customer:{customerId}`

**Server → Customer Events**:

```typescript
// Delivery status update
{
  event: "delivery.status_changed",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    status: "assigned" | "picked" | "delivered",
    agent: {
      id: 123,
      name: "John Delivery",
      phone: "+201234567890"
    },
    ts: "2026-05-26T14:15:00Z"
  }
}

// Real-time agent location
{
  event: "delivery.position",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    lat: 30.0544,
    lng: 31.2457,
    ts: "2026-05-26T14:15:30Z"
  }
}
```

---

### E.3 Restaurant Branch Channel: `branch:{branchId}`

**Server → Restaurant Events**:

```typescript
// Delivery assigned to order
{
  event: "delivery.assigned",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    agentId: 123,
    ts: "2026-05-26T14:15:00Z"
  }
}

// Delivery status update
{
  event: "delivery.status_changed",
  payload: {
    orderId: "550e8400-e29b-41d4-a716-446655440000",
    status: "assigned" | "picked" | "delivered",
    agent: { id: 123 },
    ts: "2026-05-26T14:15:00Z"
  }
}
```

---

## F. Error Responses

### Standard Error Format

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Order not found",
    "statusCode": 404,
    "timestamp": "2026-05-26T14:15:00Z",
    "correlationId": "corr-abc123"
  }
}
```

### Common Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `ORDER_NOT_FOUND` | 404 | Order does not exist |
| `INVALID_TRANSITION` | 400 | Status transition not allowed |
| `ORDER_ALREADY_ASSIGNED` | 409 | Order already has delivery agent |
| `ORDER_NOT_READY` | 409 | Order not in READY status for assignment |
| `AGENT_NOT_ONLINE` | 400 | Agent is not currently online |
| `NO_ELIGIBLE_AGENTS` | 400 | No agents available in delivery radius |
| `MAX_REASSIGNMENT_EXCEEDED` | 409 | Too many reassignment attempts |
| `INSUFFICIENT_BALANCE` | 409 | Restaurant balance too low for payout |
| `INSUFFICIENT_PERMISSION` | 403 | User lacks required permission |
| `IDEMPOTENCY_CONFLICT` | 409 | Different body with same idempotency key |

---

## G. Pagination

All list endpoints use cursor-based pagination:

```json
{
  "data": [...],
  "pagination": {
    "nextCursor": "cur_abc123",
    "hasMore": true
  }
}
```

**Query Parameters**:
- `limit` - Page size (default varies, max 100)
- `cursor` - Opaque cursor from previous response's `nextCursor`

---

## H. Rate Limits (Recommended)

- Assignment broadcast job: Every 60 seconds (background)
- Agent presence ping: Every 5 minutes (client-side responsibility)
- Agent position updates: Unlimited (only broadcasted to customer)
- Order status updates: Unlimited (idempotency protects duplicates)

---

## I. Authentication & RBAC

All endpoints require JWT token with `X-Region` header.

**Permissions Required**:
- `deliveries:assign` - Manual assignment/reassignment
- `orders:read` - View restaurant orders
- `orders:update` - Update order status
- `finance:read` - View balance/payouts
- `finance:payout_create` - Record payouts (admin only)

---

## J. Testing Examples

### Test: Assign Order to Agent

```bash
curl -X POST "https://api.quickbite.io/restaurant/1/branch/42/deliveries/assign/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer <jwt_token>" \
  -H "X-Region: eg" \
  -H "Content-Type: application/json" \
  -d '{"agentId": 123}'
```

### Test: Update Delivery Status

```bash
curl -X PATCH "https://api.quickbite.io/orders/550e8400-e29b-41d4-a716-446655440000/delivery/status" \
  -H "Authorization: Bearer <jwt_token>" \
  -H "X-Region: eg" \
  -H "Content-Type: application/json" \
  -d '{"action": "picked"}'
```

### Test: Get Restaurant Balance

```bash
curl -X GET "https://api.quickbite.io/restaurant/1/finance/balance" \
  -H "Authorization: Bearer <jwt_token>" \
  -H "X-Region: eg"
```

---

## K. Implementation Status

✅ All endpoints implemented
✅ RBAC permissions enforced
✅ WebSocket events broadcasted
✅ Idempotency supported on write endpoints
✅ Cursor pagination on list endpoints
✅ Background job for order broadcast
✅ TypeScript compilation successful
✅ Error handling consistent

