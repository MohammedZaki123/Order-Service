---
name: Delivery Agent Module
description: Business logic, DTOs, services, repositories and controller contract for assigning delivery agents and tracking delivery status
type: reference
---

# Delivery Agent Module

## Overview

The Delivery Agent Module is responsible for managing the complete delivery lifecycle—from assigning delivery agents to orders after payment, tracking their progress in real-time, and maintaining delivery analytics. This module integrates tightly with the Orders module (delivery only starts after CONFIRMED payment) and communicates synchronously with the Core Service to validate agent availability.

---

## Responsibilities

| Responsibility | Owner | Trigger |
|---|---|---|
| Assign delivery agent to order | Delivery Service | Order payment succeeds (CONFIRMED status) |
| Validate agent exists & is available | Core Service API (HTTP) | Before assignment |
| Track delivery status transitions | Delivery Service | Agent updates via mobile app |
| Cache available agents | Redis | Every 30s (background refresh) |
| Broadcast delivery events | WebSocket | Status update committed to DB |
| Provide logistics dashboard | Delivery Controller | Admin query for pending deliveries |
| Handle reassignment | Delivery Service | Admin overrides agent for delivery |
| Prevent duplicate assignments | Repository (optimistic lock) | Concurrent assignment attempts |

---

## State Machine

```
                ┌─────────────┐
                │  ASSIGNED   │  Agent accepted delivery
                └──────┬──────┘
                       │
                       ▼
                ┌─────────────────┐
                │  IN_TRANSIT     │  Agent picked up order from restaurant
                └──────┬──────────┘
                       │
                       ▼
                ┌─────────────────┐
                │   DELIVERED     │  Agent delivered to customer
                └─────────────────┘

Cancellation allowed at any point:
    ASSIGNED ──┐
               │  (via cancel or order cancellation)
    IN_TRANSIT ├──────► CANCELLED
```

**State Transition Rules**:
- ✓ `ASSIGNED → IN_TRANSIT` (agent confirms pickup from restaurant)
- ✓ `IN_TRANSIT → DELIVERED` (agent confirms delivery to customer)
- ✓ Any state → `CANCELLED` (order/delivery cancelled, agent removed)
- ✗ `DELIVERED → *` (final state, no transitions allowed)
- ✗ Backward transitions (e.g., `DELIVERED → IN_TRANSIT` not allowed)

---

## DTOs (Data Transfer Objects)

### AssignAgentRequest
**Used**: `POST /delivery/assign`  
**Purpose**: Request assignment of a delivery agent to a confirmed order

```typescript
{
  "orderId": "uuid",                    // Required: UUID of the confirmed order
  "deliveryAgentId": "uuid",            // Required: UUID from core_service.delivery_agents
  "regionCode": "US",                   // Required: Must match order's region
  "notes": "Handle with care"           // Optional: Special delivery instructions
}
```

**Validation Rules**:
- `orderId` must exist in `orders` table with status = `CONFIRMED`
- `deliveryAgentId` must be validated against Core Service (HTTP GET /core/delivery-agents/{id})
- `regionCode` must match token claims and order's region
- No prior assignment for this order (prevent duplicates)

### AssignAgentResponse
**Used**: `POST /delivery/assign` (201 Created)  
**Purpose**: Confirm assignment created successfully

```json
{
  "assignmentId": "550e8400-e29b-41d4-a716-446655440000",
  "orderId": "550e8400-e29b-41d4-a716-446655440001",
  "deliveryAgentId": "550e8400-e29b-41d4-a716-446655440002",
  "deliveryAgentName": "John Doe",
  "status": "ASSIGNED",
  "agentPhone": "+1-555-123-4567",           // For customer contact
  "estimatedDeliveryTime": "2026-04-21T16:15:00Z",
  "assignedAt": "2026-04-21T15:10:30Z"
}
```

### UpdateDeliveryStatusRequest
**Used**: `PUT /delivery/:assignmentId/status`  
**Purpose**: Agent updates delivery status (typically via mobile app)

```json
{
  "status": "IN_TRANSIT|DELIVERED|CANCELLED",
  "timestamp": "2026-04-21T15:30:00Z",  // When status actually changed
  "latitude": 37.7749,                  // Optional: GPS location (for IN_TRANSIT)
  "longitude": -122.4194,
  "notes": "Left at front gate"         // Optional: Delivery notes
}
```

### DeliveryStatusUpdate (WebSocket Event Payload)
**Used**: WebSocket broadcast when delivery status changes  
**Purpose**: Real-time update for customers, restaurant, admins

```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440001",
  "assignmentId": "550e8400-e29b-41d4-a716-446655440000",
  "deliveryAgentId": "550e8400-e29b-41d4-a716-446655440002",
  "status": "IN_TRANSIT",
  "statusEnum": "IN_TRANSIT",
  "updatedAt": "2026-04-21T15:30:00Z",
  "eventType": "DELIVERY_STATUS_CHANGED",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "estimatedDeliveryTime": "2026-04-21T16:15:00Z",
  "agentPhone": "+1-555-123-4567"
}
```

### DeliveryListResponse
**Used**: `GET /delivery/pending?regionCode=US&limit=20`  
**Purpose**: Paginated list of pending deliveries for logistics dashboard

```json
{
  "assignments": [
    {
      "assignmentId": "uuid",
      "orderId": "uuid",
      "restaurantName": "Pizza House",
      "customerName": "Jane Doe",
      "deliveryAddress": "123 Main St, San Francisco, CA",
      "deliveryAgentName": "John Doe",
      "status": "IN_TRANSIT",
      "priority": "STANDARD|URGENT",
      "assignedAt": "2026-04-21T15:10:30Z",
      "estimatedDeliveryTime": "2026-04-21T16:15:00Z"
    }
  ],
  "pagination": {
    "cursor": "base64_encoded_cursor",
    "hasMore": true,
    "count": 20
  }
}
```

---

## Service Layer (`pkg/delivery/service`)

### `DeliveryService.assignAgent(dto: AssignAgentRequest): Promise<AssignAgentResponse>`

**Purpose**: Create a delivery assignment for a confirmed order

**Flow**:
1. **Validate Order Exists**
   - Query `orders` table: `WHERE region_code = $1 AND order_id = $2 AND status = 'CONFIRMED'`
   - If not found → throw `OrderNotFoundException` (404)
   
2. **Validate Delivery Agent (Sync HTTP Call)**
   - HTTP GET `http://core-service/delivery-agents/{deliveryAgentId}`
   - Timeout: 2 seconds, Retry: 3x with exponential backoff
   - Check response: `{ "id": "...", "status": "AVAILABLE", "region": "US" }`
   - If agent not found or unavailable → throw `DeliveryAgentUnavailableException` (409)
   - On HTTP failure → throw `ExternalServiceException` (502)

3. **Check No Prior Assignment**
   - Query `delivery_assignments`: `WHERE region_code = $1 AND order_id = $2`
   - If found → throw `DuplicateAssignmentException` (409)

4. **Create Assignment in DB**
   ```sql
   INSERT INTO delivery_assignments 
     (region_code, assignment_id, order_id, delivery_agent_id, status, 
      assigned_at, estimated_delivery_time, version, created_at, updated_at)
   VALUES ($1, $2, $3, $4, 'ASSIGNED', NOW(), NOW() + INTERVAL '1 hour', 1, NOW(), NOW())
   RETURNING *;
   ```

5. **Emit Event for WebSocket**
   - Insert into `order_events`: `(region_code, event_id, order_id, event_type='DELIVERY_ASSIGNED', payload, created_at)`

6. **Return Response**
   - Fetch agent details from cache or Core Service
   - Build `AssignAgentResponse` with estimated delivery time

**Error Handling**:
| Error | HTTP Status | Error Code |
|-------|-------------|-----------|
| Order not found | 404 | `ORDER_NOT_FOUND` |
| Order not confirmed | 409 | `INVALID_ORDER_STATUS` |
| Agent not found | 404 | `DELIVERY_AGENT_NOT_FOUND` |
| Agent unavailable | 409 | `DELIVERY_AGENT_UNAVAILABLE` |
| Already assigned | 409 | `ALREADY_ASSIGNED` |
| Core Service timeout | 502 | `EXTERNAL_SERVICE_ERROR` |

**Idempotency**:
- Accept `Idempotency-Key` header
- Store in Redis: `idempotency:assign_delivery:{key}` → serialized response
- TTL: 5 minutes
- Return cached response on duplicate

---

### `DeliveryService.updateStatus(assignmentId: UUID, regionCode: string, dto: UpdateDeliveryStatusRequest): Promise<void>`

**Purpose**: Update delivery status (agent marks picked up, in transit, delivered)

**Flow**:
1. **Load Current Assignment**
   - Query: `SELECT * FROM delivery_assignments WHERE region_code = $1 AND assignment_id = $2`
   - If not found → throw `AssignmentNotFoundException` (404)

2. **Validate State Transition**
   - Current status: (from DB)
   - Requested status: (from request)
   - Check allowed transition (see state machine above)
   - If invalid → throw `InvalidTransitionException` (400)

3. **Update with Optimistic Locking**
   ```sql
   UPDATE delivery_assignments 
   SET status = $1, updated_at = NOW(), version = version + 1, 
       latitude = $2, longitude = $3, notes = $4
   WHERE region_code = $5 AND assignment_id = $6 AND version = $7
   RETURNING *;
   ```
   - If rowCount = 0 → concurrent update detected → retry with exponential backoff (max 3 attempts)
   - If retry exhausted → throw `OptimisticLockException` (409)

4. **Emit Event for WebSocket**
   - Insert into `order_events`: `(region_code, event_id, order_id, event_type='DELIVERY_STATUS_CHANGED', payload, created_at)`

5. **If Status = DELIVERED**
   - Call `OrderService.updateStatus(orderId, DELIVERED)` to finalize order
   - This triggers payment settlement and restaurant payout calculation

**Error Handling**:
| Error | HTTP Status | Error Code |
|-------|-------------|-----------|
| Assignment not found | 404 | `ASSIGNMENT_NOT_FOUND` |
| Invalid transition | 400 | `INVALID_TRANSITION` |
| Optimistic lock failed | 409 | `CONCURRENT_UPDATE` |

---

### `DeliveryService.listPending(regionCode: string, limit: int, cursor?: string): Promise<DeliveryListResponse>`

**Purpose**: Paginated list of pending deliveries for logistics dashboard

**Flow**:
1. **Build Query**
   ```sql
   SELECT da.*, o.total_amount, r.restaurant_name, u.user_name
   FROM delivery_assignments da
   JOIN orders o ON (da.region_code = o.region_code AND da.order_id = o.order_id)
   JOIN <core_service>.restaurants r ON o.restaurant_id = r.id
   JOIN <core_service>.users u ON o.src_acc_id = u.id
   WHERE da.region_code = $1 
     AND da.status IN ('ASSIGNED', 'IN_TRANSIT')
   ORDER BY da.assigned_at DESC
   LIMIT $2 + 1  -- fetch one extra to determine hasMore
   ```

2. **Pagination with Cursor**
   - Decode cursor: `base64(region_code:assigned_at:assignment_id)`
   - If cursor provided: add `AND (da.assigned_at, da.assignment_id) < ($3, $4)`

3. **Build Response**
   - Map rows to `DeliveryListResponse`
   - Calculate `hasMore` (if got `limit + 1` rows)
   - Encode next cursor: `base64(region_code:last_assigned_at:last_assignment_id)`

**Authorization**: Admin only

---

## Repository Layer (`pkg/delivery/repository`)

### Interface Definition

```typescript
interface DeliveryAssignmentRepository {
  insert(assignment: DeliveryAssignment): Promise<DeliveryAssignment>;
  findById(regionCode: string, assignmentId: UUID): Promise<DeliveryAssignment | null>;
  findByOrderId(regionCode: string, orderId: UUID): Promise<DeliveryAssignment | null>;
  updateStatus(
    regionCode: string,
    assignmentId: UUID,
    newStatus: DeliveryStatus,
    currentVersion: number
  ): Promise<DeliveryAssignment>;  // throws OptimisticLockException if version mismatch
  listPending(
    regionCode: string,
    limit: number,
    cursor?: string
  ): Promise<{ assignments: DeliveryAssignment[]; nextCursor: string | null }>;
}
```

### Implementation Patterns

**Optimistic Locking Example**:
```sql
UPDATE delivery_assignments 
SET status = 'DELIVERED', updated_at = NOW(), version = version + 1
WHERE region_code = $1 
  AND assignment_id = $2 
  AND version = $3
RETURNING *;

-- If no rows affected, throw OptimisticLockException(409)
```

**Batch Lookup**:
```sql
SELECT * FROM delivery_assignments
WHERE region_code = $1 AND assignment_id = ANY($2::uuid[])
ORDER BY assignment_id;
```

---

## Caching Strategy

### Available Agents Cache
**Key**: `agents:available:{region_code}`  
**Value**: JSON array of available agent objects (from Core Service)  
**TTL**: 30 seconds  
**Refresh**: Background job every 30s (no blocking calls)

```json
{
  "agents": [
    {
      "id": "uuid",
      "name": "John Doe",
      "phone": "+1-555-123-4567",
      "currentLocation": { "latitude": 37.7749, "longitude": -122.4194 },
      "activeDeliveries": 3,
      "maxConcurrentDeliveries": 5
    }
  ],
  "refreshedAt": "2026-04-21T15:10:30Z"
}
```

### Assignment Lookup Cache
**Key**: `delivery:assign:{region_code}:{order_id}`  
**Value**: Cached DeliveryAssignment object  
**TTL**: 60 seconds  
**Invalidation**: On status update

---

## Communication with Core Service

### Synchronous: Agent Validation
**When**: During assignment  
**Endpoint**: `GET /core/delivery-agents/{deliveryAgentId}`  
**Timeout**: 2 seconds  
**Retry**: 3x with exponential backoff (100ms, 200ms, 400ms)  
**Response**:
```json
{
  "id": "uuid",
  "status": "AVAILABLE|BUSY|OFFLINE",
  "region": "US",
  "name": "John Doe",
  "phone": "+1-555-123-4567"
}
```

### Asynchronous: Analytics & Payouts
**When**: Delivery completed (DELIVERED status)  
**Topic**: `core-events`  
**Message**:
```json
{
  "eventType": "DELIVERY_COMPLETED",
  "orderId": "uuid",
  "deliveryAgentId": "uuid",
  "completedAt": "2026-04-21T15:45:00Z",
  "estimatedDeliveryTime": "2026-04-21T16:15:00Z",
  "actualDeliveryTime": "2026-04-21T15:42:00Z"
}
```

---

## WebSocket Integration

### Event Broadcasting
- **Channel**: Same as orders (`ws://host/api/v1/orders/stream?region=US`)
- **Event Type**: `DELIVERY_STATUS_CHANGED`, `DELIVERY_ASSIGNED`
- **Payload**: `DeliveryStatusUpdate` (see DTOs above)
- **Subscribers**: Customer, restaurant, delivery agent, admin

### Event Sequence
1. Delivery status updated in DB
2. Row inserted into `order_events` table
3. PostgreSQL LISTEN/NOTIFY triggers
4. Event broadcaster publishes to WebSocket clients
5. Clients receive in real-time

---

## Error Handling & Idempotency

### Idempotent Assignment
- Accept `Idempotency-Key` header (UUID)
- Store in Redis: `idempotency:delivery:assign:{key}` → `{ assignmentId, status }`
- TTL: 5 minutes
- Return cached response on duplicate request

**Example**:
```http
POST /delivery/assign
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

-- First call: Returns 201 with new assignmentId
-- Second call (same Idempotency-Key): Returns 201 with SAME assignmentId
```

### Optimistic Locking for Status Updates
Prevents race conditions when agent updates status concurrently:
- Every row has `version` column (incremented on update)
- UPDATE uses `WHERE version = expected_version`
- If mismatch → retry with fresh data
- Max 3 retries, then fail with 409

---

## Authorization & Access Control

| Endpoint | Account Types | Notes |
|----------|--------------|-------|
| `POST /delivery/assign` | ADMIN, RESTAURANT_MANAGER | Assign agents manually |
| `PUT /delivery/:id/status` | DELIVERY_AGENT | Agent updates own status |
| `GET /delivery/pending` | ADMIN, DELIVERY_AGENT | Agent sees own; Admin sees all |
| `POST /delivery/:id/reassign` | ADMIN | Override current assignment |

---

## Testing Strategy

### Unit Tests
- [ ] State machine transitions (valid & invalid)
- [ ] Service layer methods with mocked repository & Core Service client
- [ ] Error handling (agent not found, order not confirmed, etc.)
- [ ] Idempotency key handling
- [ ] Coverage: >85%

### Integration Tests
- [ ] Happy path: Create order → Confirm payment → Assign agent → Update status → Deliver
- [ ] Concurrent assignment attempts (only one succeeds)
- [ ] Concurrent status updates (optimistic lock tested)
- [ ] Invalid state transitions
- [ ] WebSocket event broadcasting
- [ ] Coverage: End-to-end flows

---

*The delivery agent module respects the core-service's clean architecture layers, uses the same repository pattern, and re-uses the shared WebSocket/event infrastructure.*

