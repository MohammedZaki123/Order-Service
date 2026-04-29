---
name: Implementation Plan
description: Step-by-step roadmap for building the Order Service, including database setup, module development, and testing strategy
type: reference
---

# Order Service - Implementation Plan

## Overview

This document provides a detailed, phase-by-phase implementation plan for the QuickBite Order Service. The service will be built incrementally, starting with foundational database and infrastructure setup, followed by module implementation (Orders → Payments → Delivery → WebSocket), extensive testing, and finally DevOps integration.

**Timeline**: 8 weeks  
**Team Size**: 2-3 developers  
**Dependencies**: Core Service API available, PostgreSQL/Redis infrastructure  
**Technology Stack**: Node.js/TypeScript, Express, PostgreSQL, Redis, Socket.io

---

## Phase 1: Database Foundation & Infrastructure Setup (Week 1)

### Objectives
- Set up PostgreSQL database with proper schema, partitioning, and indexes
- Configure region-based sharding
- Create migration system and test infrastructure
- Establish local development environment

### Tasks

#### 1.1 Database Schema Creation
- [ ] Create base tables:
  - `orders` (with composite PK: region_code, order_id)
  - `order_items` (with FK to orders)
  - `payments` (with FK to orders)
  - `delivery_assignments` (with FK to orders)
  - `order_events` (audit log for WebSocket)
- [ ] Add columns with proper types and constraints:
  - `src_acc_id` (nullable for system orders)
  - `dst_acc_id` (restaurant owner)
  - `restaurant_id` (FK to core_service.restaurants)
  - `delivery_address` (JSONB)
  - `payload` (JSONB for events)
  - `version` (for optimistic locking)
  - `idempotency_key` (for deduplication)
- [ ] Add CHECK constraints:
  - `total_amount > 0`
  - `quantity > 0`
  - `currency IN ('USD', 'EUR', 'EGP', ...)`
- [ ] Test schema with sample data

#### 1.2 Partitioning & Sharding Setup
- [ ] Create PostgreSQL declarative partitioning:
  - Parent table: `orders`
  - Child partitions: `orders_us`, `orders_eu`, `orders_apac`, `orders_latam`
  - Same for `order_items`, `payments`, `delivery_assignments`, `order_events`
- [ ] Verify partition pruning with `EXPLAIN ANALYZE`
- [ ] Document partition addition procedure for new regions
- [ ] Create utility function: `fn_get_shard(region_code)` → connection string

#### 1.3 Indexes (Query-Driven)
- [ ] Create composite indexes:
  - Orders: `(region_code, src_acc_id, created_at DESC)` - for customer lookup
  - Orders: `(region_code, dst_acc_id, created_at DESC)` - for restaurant lookup
  - Orders: `(region_code, order_status)` - for status filtering
  - Payments: `(region_code, order_id, status)` - for order payment lookup
  - Payments: `(region_code, kashier_payment_id)` - UNIQUE, for webhook lookup
  - Delivery: `(region_code, delivery_agent_id, status)` - for agent lookup
  - Events: `(region_code, order_id, created_at DESC)` - for event replay
- [ ] Verify index selectivity with `EXPLAIN ANALYZE`
- [ ] Create monitoring query: `SELECT * FROM pg_stat_user_indexes`
- [ ] Document index maintenance strategy

#### 1.4 Foreign Key Constraints
- [ ] Define FK relationships:
  - `orders.src_acc_id` → `core_service.users.id` (ON DELETE SET NULL)
  - `orders.dst_acc_id` → `core_service.users.id` (ON DELETE RESTRICT)
  - `orders.restaurant_id` → `core_service.restaurants.id` (ON DELETE RESTRICT)
  - `order_items.product_id` → `core_service.products.id` (ON DELETE RESTRICT)
  - `payments.order_id` → `orders` (ON DELETE CASCADE)
  - `delivery_assignments.order_id` → `orders` (ON DELETE CASCADE)
- [ ] Test FK violation scenarios (should fail gracefully)
- [ ] Verify cross-database FK works (if needed, use application-level validation)

#### 1.5 Migration System
- [ ] Set up Knex.js or Flyway migrations:
  - `migrations/001_init.sql` - Core tables
  - `migrations/002_partitions.sql` - Partitioning setup
  - `migrations/003_indexes.sql` - Composite indexes
  - `migrations/004_functions.sql` - PL/pgSQL functions
- [ ] Create migration rollback procedure
- [ ] Test migration on fresh database (empty state)
- [ ] Test migration on existing database (with data)
- [ ] Document migration deployment process

#### 1.6 Local Development Environment
- [ ] Create `docker-compose.yml`:
  - PostgreSQL 15 (order_service database)
  - Redis 7 (for cache and sessions)
  - Optional: Kafka 3.x (for async events)
- [ ] Create `.env.example`:
  - DATABASE_URL
  - REDIS_URL
  - CORE_SERVICE_URL
  - KASHIER_SECRET (placeholder)
  - JWT_SECRET (test key)
- [ ] Document setup:
  - `npm install`
  - `docker-compose up`
  - `npm run migrate`
  - `npm run seed` (optional test data)
- [ ] Create seed script for test data (sample orders, payments, agents)

#### 1.7 Testing Infrastructure
- [ ] Set up Jest with TypeScript:
  - `jest.config.js` with ts-jest
  - Test environment: `@shelf/jest-sql`
- [ ] Create test database setup:
  - Isolated test DB per test suite
  - Auto-cleanup with `afterEach()`
- [ ] Create Docker Compose for test stack:
  - PostgreSQL (port 5433)
  - Redis (port 6380)
- [ ] Create test fixtures:
  - `test/fixtures/db-setup.ts` - Database initialization
  - `test/fixtures/app-factory.ts` - Express app setup for tests
  - `test/fixtures/mocks.ts` - Mock repositories, HTTP clients
  - `test/fixtures/factories.ts` - Factory functions for test data

#### 1.8 Database Monitoring & Health Checks
- [ ] Create health check query:
  - Check connection pool
  - Verify table counts (non-empty)
  - Test write capability (INSERT/UPDATE)
- [ ] Create monitoring views:
  - `pg_stat_activity` - Active connections
  - `pg_stat_user_tables` - Table sizes
  - `pg_stat_user_indexes` - Index usage
- [ ] Document baseline metrics:
  - Expected query latency
  - Expected index selectivity
  - Expected table growth rate

### Deliverables
- [ ] SQL schema in `migrations/` directory
- [ ] Partitioned tables with composite PKs
- [ ] Query-driven indexes (with EXPLAIN ANALYZE output)
- [ ] Working migration system
- [ ] Local `docker-compose.yml`
- [ ] `.env.example` file
- [ ] Test infrastructure (Jest, testcontainers)
- [ ] Database documentation in `docs/`

### Definition of Done (DoD)
- ✅ `npm run migrate` completes without errors
- ✅ `docker-compose up` spins up full stack
- ✅ `npm test` in test/ runs at least one test
- ✅ Schema changes documented in `docs/database_design.md`

---

## Phase 2: Orders Module Implementation (Week 2-3)

### Objectives
- Implement Order entity and business logic
- Build REST endpoints for order CRUD operations
- Set up order caching in Redis
- Implement validation and error handling
- Achieve >80% test coverage

### Tasks

#### 2.1 Domain Layer: Order Entity & Types
- [ ] Create `src/pkg/order/entity.ts`:
  - `Order` class with constructor and getters
  - State machine methods: `confirmOrder()`, `markPreparing()`, `markReady()`, `markPickedUp()`, `deliver()`, `cancel()`
  - Each method validates state transitions
  - Immutable properties: `id`, `regionCode`, `restaurantId`, `srcAccId`
  - Mutable properties: `status`, `items`, `deliveryAddress`
- [ ] Create `src/pkg/order/types.ts`:
  - `OrderStatus` enum: PENDING, CONFIRMED, PREPARING, READY, PICKED_UP, DELIVERED, CANCELLED
  - `OrderItem` interface: productId, quantity, pricePerUnit, subtotal
  - `DeliveryAddress` interface: street, city, state, zipCode, latitude, longitude, instructions
  - Constants: `MAX_ORDER_ITEMS = 100`, `MIN_ORDER_AMOUNT = 1.00`

#### 2.2 Repository Layer: Order Data Access
- [ ] Create `src/pkg/order/repository.ts` (interface):
  ```typescript
  interface OrderRepository {
    insert(order: Order): Promise<Order>;
    findById(regionCode: string, orderId: UUID): Promise<Order | null>;
    findByCustomerId(regionCode: string, customerId: UUID, opts?: PaginationOpts): Promise<Order[]>;
    findByRestaurantId(regionCode: string, restaurantId: UUID, opts?: PaginationOpts): Promise<Order[]>;
    updateStatus(regionCode: string, orderId: UUID, newStatus: OrderStatus): Promise<void>;
    delete(regionCode: string, orderId: UUID): Promise<void>;
  }
  ```
- [ ] Create `src/lib/db/order.repository.ts` (implementation using pg):
  - Implement `insert()` with transaction (orders + order_items in single txn)
  - Implement `findById()` with LEFT JOIN to order_items
  - Implement `findByCustomerId()` with cursor-based pagination
  - Implement `findByRestaurantId()` with cursor-based pagination
  - Use parameterized queries (prevent SQL injection)
  - All queries include `region_code = $1` as first predicate

#### 2.3 Service Layer: Order Business Logic
- [ ] Create `src/pkg/order/service.ts`:
  - `OrderService.createOrder(dto: CreateOrderRequest, regionCode: string): Promise<Order>`
    - Call `CoreServiceClient.validateRestaurant(restaurantId)`
    - Call `CoreServiceClient.validateCustomer(srcAccId)` if provided
    - Calculate totals: `subtotal`, `tax` (10%), `platformFee` (5%), `totalAmount`
    - Insert order and items in transaction
    - Emit `OrderCreated` event
    - Cache in Redis with 5-min TTL
  - `OrderService.getById(regionCode, orderId): Promise<Order>`
    - Try Redis cache first
    - On miss: query DB, cache result
  - `OrderService.updateStatus(regionCode, orderId, newStatus): Promise<void>`
    - Validate state transition (using entity methods)
    - Update DB with new status
    - Invalidate cache
    - Emit `OrderStatusChanged` event
  - `OrderService.cancelOrder(regionCode, orderId, reason): Promise<void>`
    - Check if PENDING or CONFIRMED
    - Trigger refund if payment exists
    - Update status to CANCELLED
    - Emit `OrderCancelled` event
  - Error handling: Wrap DB/external call errors in `OrderException`

#### 2.4 Application Layer: DTOs & Validation
- [ ] Create `src/app/orders/dto.ts`:
  - `CreateOrderRequest` with `@IsUUID()`, `@IsArray()`, `@Min()` decorators (using class-validator)
  - `OrderResponse` matching Order entity fields
  - `OrderItemResponse` matching OrderItem interface
  - `CreateOrderResponse` with minimal fields (orderId, status, totalAmount, createdAt)
- [ ] Create `src/lib/validation/schemas.ts`:
  - Zod schemas for validation (alternative to class-validator)
  - Example: `createOrderSchema = z.object({ restaurantId: z.string().uuid(), ... })`

#### 2.5 Controller & Routes
- [ ] Create `src/app/orders/controller.ts`:
  - `OrderController` with Express request handlers
  - `POST /orders` - createOrder()
    - Parse body, validate with Zod
    - Extract regionCode from JWT token
    - Call `orderService.createOrder()`
    - Return 201 with `CreateOrderResponse`
  - `GET /orders/:orderId` - getOrder()
    - Extract orderId from URL
    - Call `orderService.getById()`
    - Return 200 with `OrderResponse`
  - `GET /orders` - listOrders()
    - Parse query params (limit, cursor, status)
    - Call `orderService.listByCustomer()` or `listByRestaurant()`
    - Return 200 with paginated results
  - `PUT /orders/:orderId/status` - updateStatus()
    - Parse body (newStatus)
    - Call `orderService.updateStatus()`
    - Return 200 with updated `OrderResponse`
  - `DELETE /orders/:orderId` - cancelOrder()
    - Parse body (reason)
    - Call `orderService.cancelOrder()`
    - Return 200 with cancellation response
- [ ] Create `src/app/orders/routes.ts`:
  - Express router with all endpoints
  - Attach middleware: `authMiddleware`, `validationMiddleware`
  - Register in `src/app/server.ts`

#### 2.6 Middleware & Error Handling
- [ ] Create `src/app/middleware/auth.ts`:
  - Extract JWT from Authorization header
  - Verify signature and expiration
  - Extract `sub`, `accountType`, `regionCode` from token
  - Attach to `req.user`
  - Reject if invalid (401 Unauthorized)
- [ ] Create `src/app/middleware/validation.ts`:
  - Use Zod to validate request body/params
  - Return 400 if validation fails with error details
- [ ] Create `src/app/middleware/errorHandler.ts`:
  - Catch all errors (sync and async)
  - Map `OrderException` → 400/404/409
  - Map `ExternalServiceError` → 502
  - Log with traceId
  - Return error JSON

#### 2.7 Caching Strategy
- [ ] Create `src/lib/cache/order.cache.ts`:
  - `cacheKey(regionCode, orderId) → string`
  - `getOrder(regionCode, orderId) → Promise<Order | null>`
    - Query Redis with key
    - Deserialize JSON if found
  - `setOrder(regionCode, orderId, order) → Promise<void>`
    - Serialize order to JSON
    - Set in Redis with TTL 300 (5 min)
  - `invalidateOrder(regionCode, orderId) → Promise<void>`
    - Delete from Redis
- [ ] Configure Redis connection in `src/lib/cache/index.ts`:
  - Create Redis client with pool
  - Error handling (log, don't crash)
  - Graceful degradation (if Redis down, continue without caching)

#### 2.8 Unit Tests
- [ ] Create `test/unit/orders/order.entity.spec.ts`:
  - Test state transitions: PENDING → CONFIRMED → PREPARING → ... → DELIVERED
  - Test invalid transitions (e.g., PENDING → DELIVERED)
  - Test immutability of key properties
- [ ] Create `test/unit/orders/order.service.spec.ts`:
  - Mock `OrderRepository`, `CoreServiceClient`, `Redis`
  - Test `createOrder()` with valid input
  - Test `createOrder()` with invalid restaurant
  - Test `createOrder()` with missing customer
  - Test `getById()` with cache hit/miss
  - Test `updateStatus()` with invalid transition
  - Test error handling (wrap errors)
  - Coverage target: >85%
- [ ] Create `test/unit/orders/order.controller.spec.ts`:
  - Mock service layer
  - Test request parsing (body, params)
  - Test response format (status code, JSON structure)
  - Test error responses (400, 404, 409)
  - Coverage target: >80%

#### 2.9 Integration Tests
- [ ] Create `test/integration/orders.e2e.ts`:
  - Setup: Spin up Express app + PostgreSQL + Redis
  - Test happy path: POST /orders → GET /orders/{id} → PUT /orders/{id}/status
  - Verify DB state after each operation
  - Verify cache is used (subsequent GET is fast)
  - Test edge cases:
    - Duplicate `Idempotency-Key` (should return same response)
    - Invalid `regionCode` (401 or 400)
    - Missing authentication (401)
  - Test concurrent order creation (verify no race conditions)
  - Coverage target: End-to-end flows tested

#### 2.10 Documentation
- [ ] Update `docs/orders_module.md`:
  - Add DTOs with examples
  - Add service layer methods
  - Add repository interface
  - Add error codes and meanings
- [ ] Add code comments:
  - JSDoc for public methods
  - Inline comments for complex logic
  - Example: state transition validation

### Deliverables
- [ ] `src/pkg/order/` (entity, types, service, repository interface)
- [ ] `src/lib/db/order.repository.ts` (implementation)
- [ ] `src/app/orders/` (controller, dto, routes)
- [ ] `src/lib/cache/order.cache.ts`
- [ ] `src/app/middleware/` (auth, validation, errorHandler)
- [ ] Unit tests with >80% coverage
- [ ] Integration tests (E2E flows)
- [ ] Updated documentation

### Definition of Done (DoD)
- ✅ `npm test -- test/unit/orders` passes
- ✅ `npm test -- test/integration/orders` passes
- ✅ Code coverage: >85% (statements, branches)
- ✅ ESLint clean (no warnings)
- ✅ Manual testing: Create, read, update, delete orders via REST API
- ✅ Documentation updated in `docs/`

---

## Phase 3: Payments Module Implementation (Week 3-4)

### Objectives
- Integrate Kashier v3 payment API
- Implement payment webhooks with signature verification
- Handle payment idempotency and optimistic locking
- Implement refund processing
- Achieve >80% test coverage

### Tasks

#### 3.1 Domain Layer: Payment Entity & Types
- [ ] Create `src/pkg/payment/entity.ts`:
  - `Payment` class with immutable `id`, `orderId`, `amount`, `currency`
  - Mutable `status` property with getters/setters
  - Methods: `markSuccess(transactionId)`, `markFailed(reason)`, `markCancelled()`
- [ ] Create `src/pkg/payment/types.ts`:
  - `PaymentStatus` enum: PENDING, SUCCESS, FAILED, CANCELLED, REFUNDED
  - `PaymentMethod` enum: KASHIER, COD
  - `KashierWebhookPayload` interface

#### 3.2 Kashier Integration Client
- [ ] Create `src/lib/http/kashier.client.ts`:
  - `KashierClient.createSession(order: Order): Promise<KashierSession>`
    - POST to `https://api.kashier.io/v3/payment-sessions`
    - Body: amount, currency, orderId, customer details, redirectUrl
    - Response: sessionId, sessionUrl
    - Timeout: 5s, retry 3x with exponential backoff
    - Circuit breaker: open if >50% errors in last 10 min
  - `KashierClient.verifySignature(payload: string, signature: string): boolean`
    - HMAC-SHA256 verification (see lib/crypto)
  - Error handling: Map Kashier errors to `ExternalServiceError`

#### 3.3 Repository Layer: Payment Data Access
- [ ] Create `src/pkg/payment/repository.ts` (interface):
  ```typescript
  interface PaymentRepository {
    insert(payment: Payment): Promise<Payment>;
    findById(regionCode: string, paymentId: UUID): Promise<Payment | null>;
    findByOrderId(regionCode: string, orderId: UUID): Promise<Payment | null>;
    updateStatus(regionCode: string, paymentId: UUID, newStatus: PaymentStatus, expectedVersion: int): Promise<void>;
    findByKashierId(kashierId: string): Promise<Payment | null>;
  }
  ```
- [ ] Create `src/lib/db/payment.repository.ts` (implementation):
  - Implement with optimistic locking: UPDATE ... WHERE version = $expectedVersion
  - Use `INSERT ... ON CONFLICT DO NOTHING` for idempotency if needed

#### 3.4 Service Layer: Payment Business Logic
- [ ] Create `src/pkg/payment/service.ts`:
  - `PaymentService.initiatePayment(dto: CreatePaymentRequest): Promise<CreatePaymentResponse>`
    - Validate order exists (DB query)
    - Validate amount matches order total
    - Call `kashierClient.createSession()`
    - Insert `Payment` record in DB with status PENDING
    - Return session URL for frontend redirect
  - `PaymentService.handleWebhook(payload: KashierWebhookPayload): Promise<void>`
    - Acquire Redis lock on `kashier_webhook:{kashierId}`
    - If lock acquisition fails → webhook already processing → return early
    - Update payment status with optimistic locking
    - If SUCCESS → call `orderService.updateStatus(CONFIRMED)`
    - If FAILED → log for admin review
    - Emit `PaymentUpdated` event
    - Release lock
  - `PaymentService.refundPayment(paymentId, amount, reason): Promise<Refund>`
    - Check payment is SUCCESS
    - Call Kashier refund API (async)
    - Create `Refund` record with status PENDING
    - Return refund ID
  - Error handling: Wrap errors in `PaymentException`

#### 3.5 Application Layer: DTOs
- [ ] Create `src/app/payments/dto.ts`:
  - `CreatePaymentRequest`: orderId, paymentMethod, regionCode, returnUrl, cancelUrl, idempotencyKey
  - `CreatePaymentResponse`: paymentId, kashierSessionUrl, status, createdAt
  - `PaymentStatusResponse`: paymentId, orderId, status, amount, processedAt
  - `RefundRequest`: amount, reason, notes
  - `RefundResponse`: refundId, status, amount, createdAt
- [ ] Add validation with class-validator or Zod

#### 3.6 Webhook Handler
- [ ] Create `src/app/payments/webhooks.ts`:
  - `POST /payments/kashier-webhook` (PUBLIC endpoint)
  - Extract raw body (preserve for signature verification)
  - Extract `X-Kashier-Signature` header
  - Verify signature using `KashierClient.verifySignature()`
  - If invalid → return 400
  - Parse JSON payload
  - Call `paymentService.handleWebhook()`
  - Return 200 (always successful, idempotent)
  - Implement rate limiting: Max 1000 webhooks/hour per region

#### 3.7 Controller & Routes
- [ ] Create `src/app/payments/controller.ts`:
  - `POST /payments` - initiatePayment()
    - Parse body (orderId, returnUrl, cancelUrl)
    - Call `paymentService.initiatePayment()`
    - Return 201 with `CreatePaymentResponse`
  - `GET /payments/:paymentId` - getPaymentStatus()
    - Call `paymentService.getById()`
    - Return 200 with `PaymentStatusResponse`
  - `POST /payments/:paymentId/refund` - refundPayment()
    - Admin-only endpoint
    - Parse body (amount, reason)
    - Call `paymentService.refundPayment()`
    - Return 200 with `RefundResponse`
- [ ] Create `src/app/payments/routes.ts` with all endpoints

#### 3.8 Idempotency & Webhook Safety
- [ ] Implement idempotency for `POST /payments`:
  - Accept `Idempotency-Key` header
  - Store in Redis: `idempotency:{key}` → serialized response
  - TTL: 5 min
- [ ] Implement webhook idempotency:
  - Lock on `lock:webhook:kashier:{kashierId}`
  - Redis SET with NX and PX (2s timeout)
  - If lock acquired: process webhook, update DB
  - If lock not acquired: return 200 (already processing)
- [ ] Implement optimistic locking:
  - Payment table has `version` column
  - UPDATE: `WHERE version = expected_version`
  - If rowCount = 0 → duplicate webhook or race condition

#### 3.9 Unit Tests
- [ ] Create `test/unit/payments/payment.entity.spec.ts`:
  - Test status transitions
  - Test immutability
- [ ] Create `test/unit/payments/payment.service.spec.ts`:
  - Mock `PaymentRepository`, `KashierClient`, `OrderService`
  - Test `initiatePayment()` with valid order
  - Test `initiatePayment()` with missing order (404)
  - Test `initiatePayment()` with Kashier API error (502)
  - Test `handleWebhook()` with SUCCESS status
  - Test `handleWebhook()` with duplicate (idempotent)
  - Test optimistic locking (version mismatch)
  - Coverage: >85%
- [ ] Create `test/unit/payments/kashier.client.spec.ts`:
  - Mock axios
  - Test successful session creation
  - Test API error handling
  - Test circuit breaker activation
  - Test signature verification
  - Coverage: >85%

#### 3.10 Integration Tests
- [ ] Create `test/integration/payments.e2e.ts`:
  - Setup: Create order, then initiate payment
  - Mock Kashier API response
  - Simulate webhook callback (POST /payments/kashier-webhook)
  - Verify payment status in DB
  - Verify order status updated to CONFIRMED
  - Test webhook with invalid signature (should return 400)
  - Test webhook idempotency (duplicate webhook processed only once)
  - Coverage: End-to-end payment flow

#### 3.11 Documentation
- [ ] Update `docs/payments_module.md`:
  - Add DTOs and request/response examples
  - Add Kashier API details (session URL, webhook format)
  - Add signature verification code
  - Add idempotency and optimistic locking explanation
  - Add error codes

### Deliverables
- [ ] `src/pkg/payment/` (entity, types, service, repository)
- [ ] `src/lib/http/kashier.client.ts`
- [ ] `src/app/payments/` (controller, dto, routes, webhooks)
- [ ] Unit & integration tests with >80% coverage
- [ ] Updated documentation

### Definition of Done (DoD)
- ✅ `npm test -- test/unit/payments` passes
- ✅ `npm test -- test/integration/payments` passes
- ✅ Code coverage: >85%
- ✅ Kashier webhook signature verification working
- ✅ Idempotency and optimistic locking tested
- ✅ Manual testing: Create payment, simulate webhook, verify order status

---

## Phase 4: Delivery Module Implementation (Week 4)

### Objectives
- Implement delivery assignment and tracking
- Build delivery status state machine
- Integrate with core service for agent validation
- Achieve >80% test coverage

### Tasks (Summary)

#### 4.1-4.5 Delivery Entity, Repository, Service, Controller, Routes
- [ ] Create `src/pkg/delivery/` with entity, types, service, repository
- [ ] Create `src/app/delivery/` with controller, dto, routes
- [ ] Implement status transitions: ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED
- [ ] Add auto-assignment logic based on agent availability
- [ ] Implement agent validation via core service

#### 4.6-4.8 Testing
- [ ] Unit tests for delivery state machine
- [ ] Integration tests for assignment flow
- [ ] Coverage: >80%

### Deliverables
- [ ] `src/pkg/delivery/` implementation
- [ ] `src/app/delivery/` endpoints
- [ ] Unit & integration tests

### Definition of Done (DoD)
- ✅ All delivery endpoints tested
- ✅ State transitions validated
- ✅ Code coverage: >80%

---

## Phase 5: WebSocket & Real-Time Updates (Week 5)

### Objectives
- Set up Socket.io server with authentication
- Implement PostgreSQL LISTEN/NOTIFY for event broadcasting
- Publish order/payment/delivery events to WebSocket clients
- Handle connection lifecycle (connect, subscribe, disconnect)

### Tasks

#### 5.1 PostgreSQL Event System
- [ ] Create `src/lib/events/pg.notifier.ts`:
  - `PgNotifier` class manages LISTEN/NOTIFY
  - `subscribe(channel: string, callback: Function): Promise<void>`
  - Auto-reconnect on connection loss
  - Emit events to registered listeners
  - Graceful cleanup on shutdown

#### 5.2 Socket.io Server Setup
- [ ] Create `src/app/websocket/server.ts`:
  - Attach Socket.io to Express server
  - Configure CORS (allow frontend domain)
  - Set up authentication middleware
- [ ] Create `src/app/websocket/handler.ts`:
  - `WebSocketHandler` manages connections
  - On `connect`: validate JWT, extract userId, regionCode
  - On `subscribe_order`: join room `order:{orderId}:{regionCode}`
  - On `disconnect`: cleanup listeners
- [ ] Create `src/app/websocket/broadcaster.ts`:
  - `Broadcaster` publishes events to rooms
  - Maps order events to socket rooms
  - Broadcasts to all subscribers

#### 5.3 Event Publishing from Services
- [ ] Modify `src/pkg/order/service.ts`:
  - After `createOrder()` → call `broadcaster.publishOrderCreated()`
  - After `updateStatus()` → call `broadcaster.publishOrderStatusChanged()`
  - After `cancelOrder()` → call `broadcaster.publishOrderCancelled()`
- [ ] Modify `src/pkg/payment/service.ts`:
  - After webhook SUCCESS → call `broadcaster.publishPaymentUpdated()`
- [ ] Modify `src/pkg/delivery/service.ts`:
  - After `assignAgent()` → call `broadcaster.publishDeliveryAssigned()`
  - After `updateStatus()` → call `broadcaster.publishDeliveryStatusUpdated()`

#### 5.4 Event Table Cleanup
- [ ] Ensure all events inserted to `order_events` table in DB
- [ ] Events logged for audit trail and replay
- [ ] Archive old events (>30 days) to cold storage

#### 5.5 Unit Tests
- [ ] Test WebSocket authentication
- [ ] Test event broadcasting to correct rooms
- [ ] Test connection cleanup

#### 5.6 Integration Tests
- [ ] Test order creation → WebSocket event emission
- [ ] Test multiple concurrent WebSocket connections
- [ ] Test event ordering (events arrive in creation order)

### Deliverables
- [ ] `src/lib/events/pg.notifier.ts`
- [ ] `src/app/websocket/` with handler and broadcaster
- [ ] Event publishing in all service layers
- [ ] WebSocket tests

### Definition of Done (DoD)
- ✅ WebSocket server starts without errors
- ✅ Events published to connected clients
- ✅ Multiple regions isolated (no cross-region events)
- ✅ Integration tests passing

---

## Phase 6: Caching & Performance Optimization (Week 5)

### Objectives
- Implement cache-aside pattern for read-heavy endpoints
- Add circuit breaker for external calls
- Implement rate limiting
- Performance benchmarking and tuning

### Tasks

#### 6.1 Redis Caching
- [ ] Extend `src/lib/cache/` with caching for:
  - Orders: TTL 5 min
  - Payments: TTL 30 sec (less stable)
  - Delivery status: TTL 30 sec
  - Available agents: TTL 30 sec (queried from core service)
- [ ] Implement cache invalidation:
  - On order status change → invalidate order cache
  - On payment success → invalidate payment cache
  - Cascade invalidation (e.g., invalidate agent list on assignment)
- [ ] Monitor cache hit rate: target >85%

#### 6.2 Circuit Breaker Pattern
- [ ] Integrate `opossum` library:
  - Wrap core service HTTP calls
  - Config: 50% error threshold, 30s reset timeout
  - Fallback: return ServiceUnavailableError
- [ ] Wrap Kashier API calls similarly

#### 6.3 Rate Limiting
- [ ] Implement rate limiting middleware:
  - Per-user, per-endpoint limits
  - Use Redis for counter storage
  - Example: 100 POST /orders per hour per user
  - Return 429 Too Many Requests when exceeded
  - Include X-RateLimit headers in response

#### 6.4 Query Optimization
- [ ] Add query slowlog monitoring
- [ ] Identify slow queries (>100ms)
- [ ] Add missing indexes (if needed)
- [ ] Verify cursor-based pagination for list endpoints

#### 6.5 Load Testing
- [ ] Create k6 load test script:
  - Simulate peak traffic (100 RPS per region)
  - Test order creation, payment processing, delivery tracking
  - Measure p50, p95, p99 latency
  - Identify bottlenecks
- [ ] Performance targets:
  - Order creation: <500ms p99
  - Order retrieval (cached): <100ms p99
  - Payment webhook: <1s p99
- [ ] Document performance results

### Deliverables
- [ ] Cache configuration and TTL strategy
- [ ] Circuit breaker integration
- [ ] Rate limiting middleware
- [ ] Load test results

### Definition of Done (DoD)
- ✅ Cache hit rate >85% in production simulation
- ✅ Load test: 100 RPS handled with <500ms p99 latency
- ✅ Circuit breaker activates on service degradation

---

## Phase 7: Testing & Documentation (Week 6)

### Objectives
- Achieve >80% code coverage across all modules
- Generate complete API documentation
- Write integration test suite
- Create troubleshooting guides

### Tasks

#### 7.1 Unit Test Coverage
- [ ] Review coverage report (`npm test -- --coverage`)
- [ ] Identify uncovered branches (if-else, error paths)
- [ ] Add tests for edge cases:
  - Negative amounts
  - Null references
  - Concurrent updates (race conditions)
  - Invalid state transitions
  - External service timeouts
- [ ] Target: >85% statements, >80% branches

#### 7.2 Integration Test Suite
- [ ] End-to-end flows:
  - Customer creates order → Restaurant accepts → Agent assigned → Delivery completed
  - Customer initiates payment → Kashier webhook → Order confirmed
  - Order cancellation with refund
  - Invalid order state transitions
- [ ] Concurrency tests:
  - 10 concurrent order creations
  - 10 concurrent webhook callbacks
  - Verify no duplicate orders/payments
- [ ] Failure scenarios:
  - Core service unavailable (circuit breaker)
  - Database connection lost (retry)
  - Kashier API timeout (backoff)
  - WebSocket disconnection (reconnect)

#### 7.3 API Documentation
- [ ] Generate OpenAPI spec from controllers (using Swagger/OpenAPI decorators)
- [ ] Export as `openapi.yaml`
- [ ] Host on API docs portal (Swagger UI)
- [ ] Document error codes with examples
- [ ] Update `docs/api_contracts.md`

#### 7.4 Code Documentation
- [ ] JSDoc comments on all public functions
- [ ] README.md with:
  - Architecture overview
  - Setup instructions
  - Running tests
  - Deployment process
- [ ] CONTRIBUTING.md with:
  - Code style guidelines
  - PR process
  - Git workflow

#### 7.5 Troubleshooting Guides
- [ ] Create `docs/troubleshooting.md`:
  - Common errors and solutions
  - Database connection issues
  - Kashier webhook failures
  - WebSocket disconnections
  - Performance debugging

### Deliverables
- [ ] Coverage report (>80%)
- [ ] OpenAPI documentation
- [ ] Complete README and docs
- [ ] Troubleshooting guide

### Definition of Done (DoD)
- ✅ `npm test` passes with >80% coverage
- ✅ OpenAPI spec generated and validated
- ✅ All endpoints documented with examples
- ✅ README explains setup and testing

---

## Phase 8: Security & DevOps (Week 7+, Ongoing)

### Objectives
- Security audit and OWASP compliance
- Build CI/CD pipeline
- Create deployment runbooks
- Set up monitoring and alerts

### Tasks (Summary)

#### 8.1 Security Audit
- [ ] OWASP Top 10 review:
  - SQL injection (parameterized queries ✅)
  - Authentication/authorization (JWT + guards ✅)
  - Sensitive data exposure (TLS, env vars ✅)
  - Insecure dependencies (`npm audit`)
  - Broken access control (RBAC checks)
- [ ] Penetration testing (request from security team)

#### 8.2 CI/CD Pipeline (GitHub Actions)
- [ ] Lint check: `npm run lint`
- [ ] Type check: `npm run type-check`
- [ ] Unit tests: `npm test`
- [ ] Integration tests: `npm run test:integration`
- [ ] Build Docker image: `docker build .`
- [ ] Deploy to staging: `helm upgrade order-service ...`

#### 8.3 Docker & Deployment
- [ ] Multi-stage Dockerfile:
  - Build stage: `node:18-alpine` with npm install
  - Runtime stage: lean image, copy only necessary files
  - Health check: `curl localhost:3000/health`
- [ ] Kubernetes manifest:
  - Deployment, Service, ConfigMap, Secret
  - Resource limits: CPU 500m, Memory 512Mi
  - Health checks (liveness, readiness)
  - Rolling update strategy

#### 8.4 Monitoring & Alerts
- [ ] Prometheus metrics:
  - `order_creation_duration_seconds`
  - `payment_webhook_processing_duration_seconds`
  - `cache_hit_rate`
  - `db_connection_pool_usage`
- [ ] Alert rules:
  - High order creation latency (>1s p99)
  - Payment webhook error rate (>1%)
  - Low cache hit rate (<80%)
  - DB connection pool exhaustion

#### 8.5 Runbooks
- [ ] Create `docs/runbooks/`:
  - Emergency: Database failover
  - Emergency: Cashier API down (fallback to COD)
  - Emergency: Redis down (graceful degradation)
  - Maintenance: Database migration
  - On-call: Investigating order failures

### Deliverables
- [ ] Security audit report
- [ ] Dockerfile & Kubernetes manifests
- [ ] GitHub Actions CI/CD pipeline
- [ ] Monitoring & alerting rules
- [ ] Operational runbooks

### Definition of Done (DoD)
- ✅ All tests pass in CI
- ✅ Docker image builds successfully
- ✅ Helm chart deploys to staging
- ✅ Monitoring dashboards display metrics
- ✅ On-call team trained on runbooks

---

## Cross-Cutting Concerns (Throughout All Phases)

### Error Handling & Logging
- [ ] Implement structured logging (JSON format) with `winston` or `pino`:
  - Include traceId, userId, regionCode in every log
  - Log levels: ERROR, WARN, INFO, DEBUG
  - Example: `logger.info('order_created', { orderId, restaurantId, traceId })`
- [ ] Global error handler catches all exceptions
- [ ] Metrics exported for error rates

### Configuration Management
- [ ] `.env` file for secrets:
  - DATABASE_URL
  - REDIS_URL
  - KASHIER_SECRET
  - JWT_SECRET
  - CORE_SERVICE_URL
- [ ] Environment-specific config:
  - Development: local databases, mock services
  - Staging: real databases, real Kashier sandbox
  - Production: real services, high availability

### Version Control & Git Workflow
- [ ] Branches:
  - `main` - production code (protected)
  - `develop` - integration branch
  - `feature/xxx` - feature branches
- [ ] PR process:
  - Require code review (2 approvals)
  - Run CI before merge
  - Squash commits before merge

### Team Communication
- [ ] Weekly standups: Status, blockers, next steps
- [ ] Code review process: Constructive feedback, knowledge sharing
- [ ] Documentation: Keep README and docs updated

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Core service unreachable** | High | High | Circuit breaker, graceful degradation |
| **Database migration failure** | Medium | High | Test migrations on copy of prod DB, rollback plan |
| **Kashier API changes** | Low | High | Monitor Kashier changelog, maintain API client version |
| **Performance degradation** | Medium | High | Load testing, caching, query optimization |
| **Data loss** | Low | Critical | Database replication, daily backups |
| **Security breach** | Low | Critical | Regular audits, penetration testing, secret rotation |

---

## Success Criteria (Definition of Done for Entire Project)

✅ **Functional**
- All 15+ REST endpoints implemented and tested
- WebSocket real-time updates working
- Kashier payment integration functional
- Order lifecycle complete (create → deliver)

✅ **Performance**
- Order creation <500ms p99
- Delivery updates <500ms
- Cache hit rate >85%
- Support 10k RPS per region

✅ **Reliability**
- 99.9% SLA
- Zero data loss
- Graceful error handling
- Comprehensive monitoring

✅ **Security**
- JWT authentication on all endpoints
- Kashier webhook signature verification
- OWASP Top 10 compliant
- PCI-DSS for payment data

✅ **Quality**
- Code coverage >80%
- Zero critical bugs
- ESLint clean
- Fully documented (README, API docs, runbooks)

✅ **DevOps**
- Automated CI/CD pipeline
- Docker containerization
- Kubernetes deployment
- Monitoring & alerting

---

## Timeline Summary

| Phase | Duration | Focus |
|-------|----------|-------|
| 1 | Week 1 | Database, migrations, test infrastructure |
| 2 | Weeks 2-3 | Orders CRUD, validation, caching |
| 3 | Weeks 3-4 | Kashier payments, webhooks, idempotency |
| 4 | Week 4 | Delivery assignment, tracking |
| 5 | Week 5 | WebSocket real-time, event broadcasting |
| 6 | Week 5 | Performance, load testing, optimization |
| 7 | Week 6 | Testing, documentation, API spec |
| 8 | Week 7+ | Security, DevOps, monitoring, runbooks |

**Total: 7-8 weeks** (with some phases overlapping)

---

## Next Steps

1. **Kickoff**: Review this plan with team, assign tasks
2. **Setup**: Configure repository, CI/CD, local environment
3. **Phase 1**: Begin database schema and migrations
4. **Review**: Weekly progress reviews, adjust if needed
5. **Demo**: Demonstrate each phase to stakeholders
6. **Production**: Gradual rollout with feature flags

---

*Last Updated: 2026-04-22*  
*Maintained By: QuickBite Platform Team*

