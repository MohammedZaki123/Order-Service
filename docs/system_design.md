---
name: System Design Choices
description: Architectural decisions for the Order Service – caching, sharding, communication, websockets and performance considerations
type: reference
---

# System Design Choices

## 1. Sharding by Region
* **Why** – QuickBite operates globally; traffic per region must be isolated to reduce latency and allow independent scaling.
* **Implementation** – PostgreSQL declarative partitioning on the `region_code` column. The `lib/db/ShardManager` resolves a `regionCode` to a `DataSource` whose default schema is `region_<code>`.
* **Query Discipline** – Every SQL statement **must** filter on `region_code` as the first predicate. This guarantees partition pruning and prevents accidental cross‑region scans.

## 2. Hot/Cold Database Archival
* **Hot Database** (`order_service`) – Contains only current-year orders, payments, delivery assignments, and events. All production queries target this DB.
* **Cold Archive Databases** – Historical data is moved to separate archive databases named `order_service_archive_<YYYY>` (e.g., `order_service_archive_2024`). Prior-year data is retained for compliance and auditing but not queried by the application.
* **Archival Strategy** – At year-end, a nightly batch job copies all rows where `EXTRACT(YEAR FROM created_at) < CURRENT_YEAR` to the appropriate archive DB, then deletes them from the hot DB to reclaim space.
* **Access Control** – Archive DBs use read-only credentials and are accessed only by:
  - Customer service teams (historical lookups)
  - Financial audits & reconciliation
  - Compliance reporting
* **Performance Benefit** – Hot DB remains lean (~146 GB per year), keeping indexes efficient and query latency predictable.

## 3. Redis Caching Layer
* **Cache‑aside** pattern for read‑heavy endpoints (`GET /orders/{id}`, `GET /delivery/available`).
* Key naming follows `entity:region:id` (e.g., `order:US:123e4567`).
* TTLs are short (30‑60 s) to keep data fresh while still reducing DB load.
* Writes invalidate the relevant key synchronously after a transaction commits.

## 4. Synchronous vs Asynchronous Core‑Service Interaction
| Interaction | Mode | Reason |
|-------------|------|--------|
| Validate user/restaurant existence during order creation | **Synchronous HTTP** (internal network) | Immediate feedback to the client; failures are fatal for the order creation flow.
| Audit logging, analytics events | **Asynchronous** (Kafka topic `core-events`) | Decouples the order service from downstream processing and guarantees eventual consistency.
| Delivery‑agent assignment lookup | **Synchronous** (core‑service REST) | Must ensure the agent is active before persisting the assignment.
| Order status updates to core (e.g., order completed) | **Asynchronous** (Kafka) | Core service aggregates order lifecycle for reporting; it does not need to block the order flow.

## 5. WebSocket Live Updates
* A single endpoint `ws://order-service/api/v1/orders/stream?region=XX` streams **order_events** rows via PostgreSQL `LISTEN/NOTIFY`.
* The `lib/events/ PgNotifier` subscribes to `order_events_{region}` channels. When a row is inserted, the payload is marshalled to JSON and broadcast to all connected sockets for that region.
* Heart‑beat ping/pong every 30 s; idle connections are closed after 2 min.
* Clients filter events by `event_type` (e.g., `ORDER_CREATED`, `PAYMENT_UPDATED`).

## 6. Performance & N+1 Prevention
* Services use **batch SELECT** with `JOIN` when loading an order and its items – a single query returns the full graph.
* Repository methods expose `findByIds(List<UUID>)` for bulk fetching (used by the delivery UI).
* Indexes are **query‑driven** (see `docs/database_design.md`). No unused indexes are created.
* All external HTTP calls have a **circuit breaker** (10 s timeout, 3 retries) to avoid cascading latency.

## 7. Transaction Boundaries
* Order creation, payment initiation, and delivery assignment each run in a **single DB transaction** scoped to a region shard.
* The transaction commits **before** any external HTTP call that can fail; thereafter the service performs compensating actions (e.g., rollback a payment session) if needed.

## 8. Idempotency
* Endpoints that trigger external side‑effects (`POST /orders`, `POST /payments`) accept an `Idempotency-Key` header.
* The key is stored in Redis with the resulting response for a configurable TTL (5‑15 min). Duplicate requests return the cached response without re‑invoking external APIs.

---
*These decisions keep the service horizontally scalable, low‑latency for the user‑facing API, and consistent with the patterns used in the core‑service.*
