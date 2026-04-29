---
name: Orders Module
description: Business logic, DTOs, services, repositories and controller contract for the Orders domain
type: reference
---

# Orders Module

## High‑level responsibilities
* Create a new order (customer → restaurant).
* Validate `src_acc_id` (user) and `dst_acc_id` (restaurant owner) existence in **core_service** via synchronous RPC (HTTP/REST) or asynchronous message queue.
* Persist the order and its items atomically within a transaction on the correct region shard.
* Publish an **OrderCreated** event to the `order_events` table (used by the websocket broadcaster).
* Expose CRUD‑style REST endpoints **and** a WebSocket channel for live updates.

## DTOs (Data Transfer Objects)
All request/response payloads are defined in `src/main/java/com/quickbite/order/dto` (or `src/main/kotlin/...` if Kotlin is used). The DTOs match the database columns but hide internal IDs when not needed.

### CreateOrderRequest
```json
{
  "srcAccId": "uuid | null",   // null for system orders
  "restaurantId": "uuid",
  "items": [
    {"productId": "uuid", "quantity": 2}
  ],
  "currency": "USD",
  "paymentMethod": "KASHIER",
  "regionCode": "US"
}
```
*Validation*: `restaurantId` must belong to the given `regionCode`. If `srcAccId` is supplied, a synchronous call to `core-service/users/{id}` must succeed.

### CreateOrderResponse
```json
{
  "orderId": "uuid",
  "status": "PENDING",
  "totalAmount": 23.50,
  "currency": "USD",
  "createdAt": "2026-04-21T14:32:10Z"
}
```

### OrderStatusResponse (WebSocket payload)
```json
{
  "orderId": "uuid",
  "status": "IN_PROGRESS",
  "updatedAt": "2026-04-21T14:45:00Z",
  "event": "STATUS_UPDATED"
}
```

## Service Layer (`app/orders/service`)
* `OrderService.createOrder(dto: CreateOrderRequest): CreateOrderResponse`
  * Resolve region → shard DB.
  * Begin transaction.
  * Insert into `orders` (status = `PENDING`).
  * Bulk‑insert `order_items` using `INSERT ... VALUES (...), (... )`.
  * Commit.
  * Write an **OrderCreated** row into `order_events` (payload contains minimal data for the websocket).
* `OrderService.updateStatus(orderId, newStatus)` – validates state transitions, updates DB, adds an event row.
* `OrderService.getById(orderId)` – reads from DB with left‑joins to items; caches the result in Redis for 30 s (read‑through).

## Repository Layer (`pkg/repository`)
* `OrderRepository` – thin wrapper around `sqlx` (or JDBI) that builds queries with **region_code** as the first bind parameter.
* `OrderItemRepository` – batch insert helper (`INSERT ... ON CONFLICT DO NOTHING`).
* All repositories return domain entities, not DTOs.

## Caching Strategy
* **Redis** key pattern: `order:{region}:{orderId}` → serialized JSON of the order with items.
* Cache is invalidated on status change and on item mutation (rare after creation).
* `GET /orders/{id}` first checks Redis; on miss loads from DB and writes back.

## Sync / Async Communication with Core Service
* **Synchronous**: When creating an order we need the restaurant owner’s user record. Call `GET /core/users/{id}` (internal network). Timeout 2 s, fallback to async retry queue.
* **Asynchronous**: For audit logs we push a message to the `core-events` Kafka topic; the core service may later consume it.

## WebSocket Integration (`app/websocket`)
* Endpoint: `ws://order-service/api/v1/orders/stream?region=US`.
* On connection the server subscribes to PostgreSQL `LISTEN order_events_{region}` channel (via `pg_notifier`).
* When a new `order_events` row is inserted, the listener publishes the JSON payload to all connected sockets of that region.
* Heart‑beat ping/pong every 30 s to keep connections alive.

## Error handling & Idempotency
* `CreateOrder` is **idempotent** when the client supplies an `Idempotency-Key` header. The service stores the request hash in Redis for 15 min; duplicate calls return the original response.
* All DB errors are wrapped in `OrderException` with an error code (e.g., `REGION_NOT_FOUND`, `INVALID_USER`).

---
*The module follows the core‑service’s layered architecture: Controllers → DTOs → Services → Repositories → DB, with a clear separation of concerns and no cross‑layer imports.*
