---
name: Project Guidelines & Technical Standards
description: Comprehensive guidelines, conventions, constraints and best-practices for the QuickBite Order Service. Aligns with core-service standards, emphasizing clean architecture, performance, and scalability.
---

# QuickBite Order Service – Project Guidelines (claude.md)

## Table of Contents
1. [Architectural Overview](#1-architectural-overview)
2. [Folder & Package Structure](#2-folder--package-structure)
3. [Naming Conventions](#3-naming-conventions)
4. [Database Design & Sharding](#4-database-design--sharding)
5. [Layered Architecture & Layer Isolation](#5-layered-architecture--layer-isolation)
6. [Performance & Scalability Rules](#6-performance--scalability-rules)
7. [API Contracts & DTOs](#7-api-contracts--dtos)
8. [Security & Compliance](#8-security--compliance)
9. [Idempotency & Reliability](#9-idempotency--reliability)
10. [Error Handling](#10-error-handling)
11. [Testing Guidelines](#11-testing-guidelines)
12. [Communication Patterns](#12-communication-patterns)
13. [WebSocket & Real-Time Updates](#13-websocket--real-time-updates)
14. [Constraints & Non-Functional Requirements](#14-constraints--non-functional-requirements)
15. [Implementation Roadmap](#15-implementation-roadmap)

---

## 1. Architectural Overview

The **Order Service** is a core microservice for QuickBite that owns the `order_service` PostgreSQL database, sharded by `region_code`. It serves as the single source of truth for:
- Order lifecycle (creation, acceptance, preparation, delivery)
- Payment processing (via Kashier v3)
- Delivery agent assignment and tracking
- Real-time status updates (via WebSocket)

### Service Responsibilities
| Module | Responsibilities | Dependencies |
|--------|-----------------|--------------|
| **Orders** | Order CRUD, validation, state transitions | Core service (user/restaurant validation), Redis cache |
| **Payments** | Kashier integration, webhook handling, payment state tracking | Kashier API, Orders module, Redis |
| **Delivery** | Agent assignment, delivery status tracking | Core service (agent validation), Orders module |
| **WebSocket** | Real-time event broadcasting via Socket.io | PostgreSQL LISTEN/NOTIFY, Orders/Payments/Delivery events |

### External Dependencies
- **Core Service** (HTTP, 2s timeout) – validate users, restaurants, delivery agents
- **Kashier v3 API** (HTTPS, 5s timeout) – payment session creation, webhook handling
- **PostgreSQL** (region-sharded) – transactional data storage
- **Redis** – cache-aside reads, idempotency keys, rate limiting
- **Kafka** (optional, for audit logs) – asynchronous event streaming to core service
- **Socket.io** – WebSocket server for live updates

---

## 2. Folder & Package Structure

### TypeScript/JavaScript Project Layout

```
Order-Service/
├── src/
│   ├── app/                           # Application Layer (HTTP, DI, middleware)
│   │   ├── orders/
│   │   │   ├── controller.ts          # REST endpoints: GET, POST, PUT, DELETE
│   │   │   ├── dto.ts                 # CreateOrderRequest, OrderResponse, etc.
│   │   │   └── routes.ts              # Express router with validation middleware
│   │   ├── payments/
│   │   │   ├── controller.ts
│   │   │   ├── dto.ts
│   │   │   ├── routes.ts
│   │   │   └── webhooks.ts            # Kashier webhook handler
│   │   ├── delivery/
│   │   │   ├── controller.ts
│   │   │   ├── dto.ts
│   │   │   └── routes.ts
│   │   ├── websocket/
│   │   │   ├── handler.ts             # Socket.io event listeners
│   │   │   ├── broadcaster.ts         # Event emission to rooms
│   │   │   └── middleware.ts          # Auth, region validation
│   │   ├── middleware/
│   │   │   ├── auth.ts                # JWT validation
│   │   │   ├── errorHandler.ts        # Global error handler
│   │   │   ├── logging.ts             # Request/response logging
│   │   │   └── validation.ts          # Input validation (Zod/Joi)
│   │   ├── server.ts                  # Express app initialization
│   │   └── di.ts                      # Dependency injection container (Inversify/Awilix)
│   │
│   ├── pkg/                           # Domain Layer (no app awareness, pure domain logic)
│   │   ├── order/
│   │   │   ├── entity.ts              # Order aggregate root
│   │   │   ├── types.ts               # OrderStatus enum, constants
│   │   │   ├── service.ts             # Business logic (validation, state transitions)
│   │   │   └── repository.ts          # Interface definition (abstraction)
│   │   ├── payment/
│   │   │   ├── entity.ts
│   │   │   ├── types.ts
│   │   │   ├── service.ts
│   │   │   └── repository.ts
│   │   ├── delivery/
│   │   │   ├── entity.ts
│   │   │   ├── types.ts
│   │   │   ├── service.ts
│   │   │   └── repository.ts
│   │   └── event/
│   │       ├── entity.ts              # Event audit log
│   │       ├── types.ts               # EventType enum
│   │       └── repository.ts
│   │
│   ├── lib/                           # Shared Utilities (NO domain knowledge, reusable)
│   │   ├── db/
│   │   │   ├── connection.ts          # Pool, query execution, region resolution
│   │   │   ├── sharding.ts            # ShardManager, partition pruning helpers
│   │   │   └── migrations.ts          # Flyway/Knex migration runner
│   │   ├── http/
│   │   │   ├── client.ts              # Axios wrapper with retry, timeout, circuit-breaker
│   │   │   └── errors.ts              # HTTP error types
│   │   ├── cache/
│   │   │   ├── redis.ts               # Redis client wrapper, key serialization
│   │   │   └── ttls.ts                # Cache TTL constants
│   │   ├── crypto/
│   │   │   └── hmac.ts                # HMAC-SHA256 signature verification
│   │   ├── logger/
│   │   │   └── index.ts               # Winston/Pino logger with structured JSON
│   │   ├── validation/
│   │   │   └── schemas.ts             # Zod/Joi validation schemas
│   │   ├── types.ts                   # Shared TS types (UUID, DateTimeISO, etc.)
│   │   └── errors.ts                  # Shared error classes (AppError hierarchy)
│   │
│   ├── config/
│   │   └── index.ts                   # Environment variable loader (dotenv)
│   │
│   └── main.ts                        # Application entry point

├── test/
│   ├── unit/
│   │   ├── orders/
│   │   ├── payments/
│   │   └── delivery/
│   ├── integration/
│   │   ├── orders.e2e.ts
│   │   ├── payments.e2e.ts
│   │   └── delivery.e2e.ts
│   ├── fixtures/
│   │   ├── db-setup.ts                # Test DB initialization
│   │   └── mocks.ts                   # Mock repositories, HTTP clients
│   └── docker-compose.yml             # Postgres, Redis, Kafka for integration tests

├── docs/
│   ├── database_design.md             # Schema, indexes, sharding strategy
│   ├── folder_structure.md            # Directory layout explanation
│   ├── system_design.md               # Architectural decisions
│   ├── orders_module.md               # Orders business logic, DTOs, errors
│   ├── payments_module.md             # Kashier integration, payment flow
│   ├── delivery_agent_module.md       # Delivery assignment & tracking
│   └── api_contracts.md               # Full OpenAPI spec (TODO)

├── migrations/
│   ├── 001_init.sql                   # Create orders, order_items, etc.
│   ├── 002_payments.sql               # Create payments table
│   └── 003_delivery.sql               # Create delivery_assignments, indexes

├── .env.example
├── .env.local (gitignored)
├── tsconfig.json
├── package.json
├── jest.config.js                     # Test configuration
├── dockerfile
├── docker-compose.yml                 # Local development stack
└── claude.md                          # This file

```

### Key Structural Rules

#### `lib/` Independence
- `lib/` contains **zero domain knowledge** – no Order, Payment, or Delivery types
- `lib/` may only depend on standard library and third-party utilities (redis, axios, zod)
- Other packages (`app/`, `pkg/`) depend on `lib/` but NOT vice-versa
- This allows `lib/` utilities to be extracted and shared across services

#### `pkg/` Public API
- Entities, interfaces, and core types in `pkg/` are part of the public contract
- Other services importing this package should only depend on `pkg/`, not `app/`
- Example: `const order = await orderService.getById(id)` returns a `pkg/order/entity.ts` `Order`

#### `app/` Request Handling
- Controllers accept `lib/` types and `pkg/` entities
- DTOs are defined ONLY in `app/` (not exported)
- Middleware chains (auth, validation, logging) live in `app/middleware`

---

## 3. Naming Conventions

### Code Structure Naming

| Element | Pattern | Example | Notes |
|---------|---------|---------|-------|
| **Folder** | `kebab-case` or `lowercase` | `src/app/orders` | Short, plural for modules |
| **File** | `lowercase.ts` or `PascalCase.ts` | `controller.ts`, `Order.ts` | Classes → PascalCase |
| **Interface** | `PascalCase` | `OrderRepository`, `IPaymentService` | Use `I` prefix only if multiple implementations |
| **Class** | `PascalCase` | `Order`, `OrderService`, `OrderController` | Match responsibility |
| **Function** | `camelCase` | `createOrder()`, `getOrderById()` | Action verbs first |
| **Enum** | `PascalCase` | `OrderStatus`, `PaymentMethod` | Values: `UPPER_SNAKE_CASE` |
| **Const** | `UPPER_SNAKE_CASE` | `DEFAULT_CACHE_TTL`, `MAX_ORDER_ITEMS` | Global constants |
| **Variable** | `camelCase` | `orderId`, `isConfirmed` | Boolean prefix: `is`, `has`, `can` |

### Database Naming

| Element | Pattern | Example | Notes |
|---------|---------|---------|-------|
| **Table** | `snake_case`, plural | `orders`, `order_items`, `payments` | Always lowercase |
| **Column** | `snake_case` | `order_id`, `customer_id`, `created_at` | Never mix cases |
| **Primary Key** | `(region_code, <entity>_id)` | `(region_code, order_id)` | Composite, sharding-first |
| **Foreign Key** | `fk_<child>_<parent>` | `fk_orders_customers` | Unambiguous naming |
| **Index** | `idx_<table>_<cols>_<purpose>` | `idx_orders_customer_id_created_at` | Purpose is optional but recommended |
| **Unique Constraint** | `uk_<table>_<cols>` | `uk_payments_kashier_id` | For uniqueness enforcement |
| **Check Constraint** | `ck_<table>_<condition>` | `ck_orders_amount_positive` | For data validation |

### API Naming

| Element | Pattern | Example |
|---------|---------|---------|
| **REST Endpoint** | `/api/v1/<resource>/<action>` | `GET /api/v1/orders/{orderId}` |
| **Query Parameter** | `camelCase` | `?limit=10&offset=20&sortBy=createdAt` |
| **Request Body Key** | `camelCase` | `{ "restaurantId": "...", "items": [...] }` |
| **Response Key** | `camelCase` | `{ "orderId": "...", "totalAmount": 23.50 }` |
| **Error Code** | `UPPER_SNAKE_CASE` | `INVALID_REGION_CODE`, `ORDER_NOT_FOUND` |

### Redis Key Naming

**Pattern**: `<module>:<action>:<identifier>:<region>`

| Use Case | Pattern | Example |
|----------|---------|---------|
| **Cache** | `cache:<entity>:<id>:<region>` | `cache:order:550e8400:US` |
| **Idempotency** | `idempotency:<key_hash>` | `idempotency:abc123def456` |
| **Webhook Lock** | `lock:webhook:<provider>:<id>` | `lock:webhook:kashier:pay_123` |
| **Rate Limit** | `ratelimit:<user_id>:<endpoint>` | `ratelimit:user_123:POST_orders` |
| **Session** | `session:<user_id>:<token>` | `session:user_456:jwttoken...` |

---

## 4. Database Design & Sharding

### Sharding Strategy: By Region

**Sharding Key**: `region_code` (VARCHAR(3) or VARCHAR(10))  
**Examples**: `US`, `EU`, `APAC`, `LATAM`

### Core Tables

#### `orders`
```sql
CREATE TABLE orders (
  region_code VARCHAR(10) NOT NULL,
  order_id UUID NOT NULL,
  src_acc_id UUID,                         -- NULL for SYSTEM; refs core_service.users.id
  dst_acc_id UUID NOT NULL,                -- Restaurant owner; refs core_service.users.id
  restaurant_id UUID NOT NULL,             -- refs core_service.restaurants.id
  order_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  total_amount DECIMAL(10, 2) NOT NULL CHECK (total_amount > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  delivery_address JSONB NOT NULL,         -- { street, city, zip, lat, lng }
  special_instructions TEXT,
  idempotency_key VARCHAR(255),            -- For deduplication
  version INT NOT NULL DEFAULT 1,          -- Optimistic locking
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_code, order_id),
  UNIQUE (region_code, idempotency_key)
);
```

#### `order_items`
```sql
CREATE TABLE order_items (
  region_code VARCHAR(10) NOT NULL,
  order_id UUID NOT NULL,
  item_id UUID NOT NULL,
  product_id UUID NOT NULL,               -- refs core_service.products.id
  quantity INT NOT NULL CHECK (quantity > 0),
  price_per_unit DECIMAL(10, 2) NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_code, order_id, item_id),
  FOREIGN KEY (region_code, order_id) REFERENCES orders(region_code, order_id) ON DELETE CASCADE
);
```

#### `payments`
```sql
CREATE TABLE payments (
  region_code VARCHAR(10) NOT NULL,
  payment_id UUID NOT NULL,
  order_id UUID NOT NULL,
  kashier_payment_id VARCHAR(255) UNIQUE NOT NULL,
  payment_method VARCHAR(50) NOT NULL,    -- KASHIER, COD, etc.
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  amount DECIMAL(10, 2) NOT NULL,
  currency CHAR(3) NOT NULL,
  version INT NOT NULL DEFAULT 1,         -- Optimistic locking
  processed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_code, payment_id),
  FOREIGN KEY (region_code, order_id) REFERENCES orders(region_code, order_id) ON DELETE RESTRICT
);
```

#### `delivery_assignments`
```sql
CREATE TABLE delivery_assignments (
  region_code VARCHAR(10) NOT NULL,
  assignment_id UUID NOT NULL,
  order_id UUID NOT NULL,
  delivery_agent_id UUID NOT NULL,        -- refs core_service.delivery_agents.id
  status VARCHAR(50) NOT NULL DEFAULT 'ASSIGNED',
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  picked_up_at TIMESTAMP,
  delivered_at TIMESTAMP,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_code, assignment_id),
  FOREIGN KEY (region_code, order_id) REFERENCES orders(region_code, order_id) ON DELETE CASCADE
);
```

#### `order_events`
```sql
CREATE TABLE order_events (
  region_code VARCHAR(10) NOT NULL,
  event_id UUID NOT NULL,
  order_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,       -- ORDER_CREATED, PAYMENT_UPDATED, etc.
  actor_id UUID,                          -- Who triggered the event
  payload JSONB NOT NULL,                 -- Event-specific data
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_code, event_id),
  FOREIGN KEY (region_code, order_id) REFERENCES orders(region_code, order_id) ON DELETE CASCADE
);
```

### Indexes (Query-Driven)

```sql
-- Orders: By customer, by restaurant, by status
CREATE INDEX idx_orders_customer_id_created_at 
  ON orders(region_code, src_acc_id, created_at DESC) 
  WHERE src_acc_id IS NOT NULL;

CREATE INDEX idx_orders_restaurant_id_created_at 
  ON orders(region_code, dst_acc_id, created_at DESC);

CREATE INDEX idx_orders_status 
  ON orders(region_code, order_status);

-- Payments: By order, by kashier ID
CREATE INDEX idx_payments_order_id_status 
  ON payments(region_code, order_id, status);

CREATE UNIQUE INDEX idx_payments_kashier_id 
  ON payments(region_code, kashier_payment_id);

-- Delivery: By agent, by status
CREATE INDEX idx_delivery_agent_id_status 
  ON delivery_assignments(region_code, delivery_agent_id, status);

-- Events: By order, by type (for websocket replay)
CREATE INDEX idx_order_events_order_id_created_at 
  ON order_events(region_code, order_id, created_at DESC);

CREATE INDEX idx_order_events_type_created_at 
  ON order_events(region_code, event_type, created_at DESC);
```

### Partitioning Strategy

PostgreSQL **declarative partitioning** by `region_code`:
```sql
CREATE TABLE orders (
  region_code VARCHAR(10) NOT NULL,
  order_id UUID NOT NULL,
  -- ... other columns
  PRIMARY KEY (region_code, order_id)
) PARTITION BY LIST (region_code);

CREATE TABLE orders_us PARTITION OF orders
  FOR VALUES IN ('US');
  
CREATE TABLE orders_eu PARTITION OF orders
  FOR VALUES IN ('EU');

-- Same for other region-sharded tables
```

**Benefits**:
- Partition pruning: queries filter `region_code = 'US'` only scan the `orders_us` partition
- Automatic overflow: new regions require only partition creation
- Cleaner migration history

### Foreign Key Strategy

| Reference | Type | Behavior | Notes |
|-----------|------|----------|-------|
| `src_acc_id` → `core_service.users.id` | Nullable | ON DELETE SET NULL | System orders have NULL |
| `dst_acc_id` → `core_service.users.id` | Not Null | ON DELETE RESTRICT | Prevent orphans |
| `restaurant_id` → `core_service.restaurants.id` | Not Null | ON DELETE RESTRICT | Prevent orphans |
| `product_id` → `core_service.products.id` | Not Null | ON DELETE RESTRICT | Prevent orphans |
| `delivery_agent_id` → `core_service.delivery_agents.id` | Not Null | ON DELETE RESTRICT | Prevent orphans |

### Hot/Cold Database Archival Strategy

**Per the PRD requirement (Section 9 – Data Retention):**
- **Hot DB** (`order_service`): Contains only current-year orders, payments, delivery assignments, and events queryable by the application.
- **Cold Archive DB** (`order_service_archive_<YYYY>`): Historical data for prior years. Kept for compliance and long-term auditing but not queried by the application during normal operation.

**Implementation Details:**

1. **Table Structure in Hot DB**: All queryable tables (`orders`, `order_items`, `payments`, `delivery_assignments`, `order_events`) include:
   - `created_at` timestamp (partition key for archival)
   - `region_code` (sharding key)
   - Standard primary key

2. **Annual Archival Process**:
   - At year-end (or early January), run a **nightly batch job** to copy all rows where `EXTRACT(YEAR FROM created_at) < CURRENT_YEAR` to the archive DB
   - Archive DB naming: `order_service_archive_2024`, `order_service_archive_2025`, etc.
   - Archive DB uses the same schema as the hot DB, partitioned by region
   - After successful verification, delete archived rows from the hot DB to reclaim space

3. **Archive DB Access Pattern**:
   - Archive queries are **never** performed by real-time application code
   - Used only for:
     - Customer service lookups (historical order retrieval)
     - Financial audits & reconciliation
     - Compliance reporting
   - Archive DB may use **lower IOPS** settings (cold storage tier, less frequent backups)

4. **Connection Management**:
   - Hot DB: `process.env.DATABASE_URL` (primary connection pool)
   - Archive DBs: `process.env.ARCHIVE_DATABASE_URLS` (comma-separated list, read-only credentials)
   - `lib/db/ShardManager` routes queries to hot DB by default
   - Archive queries explicitly target archive connection string

5. **Application Behavior**:
   - All application queries filter on `created_at >= DATE_TRUNC('year', NOW())` to ensure hot DB only
   - API endpoints that fetch historical orders redirect to customer service / admin dashboard (which may query archives)
   - Analytics/reporting queries use read-only replicas of the archive DBs

6. **Example Query**:
   ```sql
   -- Hot DB: Current year only (automatic partition pruning)
   SELECT * FROM orders 
   WHERE region_code = 'US' 
     AND created_at >= DATE_TRUNC('year', NOW())
     AND status = 'DELIVERED'
   ORDER BY created_at DESC;
   
   -- Archive DB: Historical data (explicit connection to archive_2024)
   -- SELECT * FROM public.orders@archive_2024 
   -- WHERE region_code = 'US' AND created_at >= '2024-01-01' ...
   ```

**Benefits**:
- **Performance**: Hot DB remains lean, indexes stay efficient, query response times predictable
- **Cost**: Cold archive uses cheaper storage tier
- **Compliance**: Full audit trail retained indefinitely
- **Scalability**: Hot DB growth is capped at ~1 year of data (~146 GB as per PRD)

---

## 5. Layered Architecture & Layer Isolation

### Request Flow Example: `POST /api/v1/orders`

```
HTTP Request
    ↓
[app/middleware/validation.ts] – Parse body, validate schema (Zod)
    ↓
[app/middleware/auth.ts] – Verify JWT, extract user context
    ↓
[app/orders/controller.ts] – Handle HTTP request/response
    ↓
[lib/http/client.ts] – Call core-service to validate customer/restaurant
    ↓
[pkg/order/service.ts] – Business logic: validate, aggregate, state transitions
    ↓
[lib/db/connection.ts] – Get connection pool for region shard
    ↓
[pkg/order/repository.ts] – Execute INSERT INTO orders, INSERT INTO order_items
    ↓
[lib/cache/redis.ts] – Invalidate cache key (if updating)
    ↓
[app/websocket/broadcaster.ts] – Emit ORDER_CREATED event
    ↓
HTTP Response (200 OK + OrderResponse DTO)
```

### Layer Responsibilities

#### `app/` – Presentation & Dependency Injection
- **Controllers**: Handle HTTP requests, parse query/path params, call services
- **DTOs**: Define request/response schemas (use `class-transformer` or `zod`)
- **Middleware**: Auth, validation, error handling, logging, CORS
- **Routes**: Express router setup, endpoint mapping
- **Entities**: Core domain objects (Order, Payment, Delivery)
- **Services**: Business logic, state machines, orchestration
- **Repositories**: Data access interfaces (NOT implementation)
- **Types**: Enums, constants, types shared across the service

#### `pkg/` – Public API
- **Cache**: defining interface for Redis cache operations (get/set/del)
- **email**: defining interface for sending emails (sendOrderConfirmation, sendDeliveryUpdate)
- **utils**: defining utility functions (calculateOrderTotal, formatCurrency)


#### `lib/` – Cross-Cutting Utilities
- **db/**: Connection pooling, sharding resolution, query execution
- **http/**: HTTP client with retry, timeout, circuit-breaker
- **cache/**: Redis client, key serialization
- **crypto/**: HMAC verification, hashing
- **logger/**: Structured logging (JSON format)
- **validation/**: Zod/Joi schema definitions
- **errors/**: Base error classes (AppError, ValidationError, NotFoundError)
- **Middleware**: Auth, validation, error handling, logging, CORS


### Dependency Direction

```
         ↑ (depends on)
         |
  app/ ──┴── pkg/ ──┬── lib/ ──── 3rd party
              ↑     |
              └─────┴─ No circular dependencies!
```

**Rules**:
- `app/` depends on `pkg/` and `lib/`
- `pkg/` depends on `lib/` only
- `lib/` depends on standard library and 3rd-party packages ONLY
- No circular imports (use dependency injection to break cycles)

---

## 6. Performance & Scalability Rules

### Rule 1: No N+1 Queries

❌ **Bad**: Loop queries
```typescript
async getOrdersWithItems(customerId: string): Promise<Order[]> {
  const orders = await this.orderRepo.findByCustomerId(customerId);
  for (const order of orders) {
    order.items = await this.itemRepo.findByOrderId(order.id); // N+1!
  }
  return orders;
}
```

✅ **Good**: Single JOIN query
```typescript
async getOrdersWithItems(customerId: string): Promise<Order[]> {
  const rows = await db.query(`
    SELECT o.*, oi.*
    FROM orders o
    LEFT JOIN order_items oi ON o.region_code = oi.region_code AND o.id = oi.order_id
    WHERE o.region_code = $1 AND o.src_acc_id = $2
    ORDER BY o.created_at DESC
  `, [regionCode, customerId]);
  
  return this.mapRowsToOrders(rows); // Combine rows into Order objects
}
```

### Rule 2: Index Strategy

**Indexes MUST be query-driven, not random.**

**Process**:
1. Write the query
2. Add index on leading WHERE + JOIN columns
3. Verify with `EXPLAIN ANALYZE`
4. Remove unused indexes quarterly

**Example: List orders by customer, sorted by creation date**
```sql
-- Query
SELECT * FROM orders 
WHERE region_code = $1 AND src_acc_id = $2 
ORDER BY created_at DESC LIMIT 20;

-- Index
CREATE INDEX idx_orders_customer_created_at 
ON orders(region_code, src_acc_id, created_at DESC) 
WHERE src_acc_id IS NOT NULL;
```

### Rule 3: Cache-Aside Pattern

**TTLs by data temperature**:
- **Hot** (5 min): Recent orders, order status, customer cart
- **Warm** (30 min): Order history, delivery agent availability
- **Cold** (no cache): Payment details, sensitive data

```typescript
async getOrder(orderId: string, regionCode: string): Promise<Order> {
  const cacheKey = `cache:order:${orderId}:${regionCode}`;
  
  // Try cache first
  let cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  
  // Cache miss: load from DB
  const order = await db.query(...);
  
  // Write back to cache (5 min TTL)
  await redis.setex(cacheKey, 300, JSON.stringify(order));
  
  return order;
}
```

### Rule 4: Connection Pooling

```typescript
// lib/db/connection.ts
const pool = new Pool({
  max: 20,                          // Max connections per region
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  application_name: 'order-service',
  statement_timeout: '30s'          // Kill queries > 30s
});
```

### Rule 5: External HTTP Calls with Circuit Breaker

```typescript
// lib/http/client.ts
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(
  async (url: string, options: any) => {
    return axios.get(url, {
      timeout: 2000,
      ...options
    });
  },
  {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  }
);

// Usage
try {
  const customer = await breaker.fire(`${CORE_SERVICE_URL}/users/${userId}`);
} catch (err) {
  if (err instanceof CircuitBreaker.OpenError) {
    throw new ExternalServiceError('Core service unavailable');
  }
}
```

### Rule 6: Pagination (Cursor-Based)

❌ **Bad**: Offset-based pagination (inefficient on large tables)
```typescript
const offset = (page - 1) * limit;
SELECT * FROM orders OFFSET $1 LIMIT $2;  // Scans + skips
```

✅ **Good**: Cursor-based pagination (efficient)
```typescript
interface CursorQuery {
  cursor?: string;  // Base64({ id, createdAt })
  limit: number;
  regionCode: string;
}

async listOrders(query: CursorQuery): Promise<OrderResponse[]> {
  const { limit, regionCode } = query;
  const { id: lastId, createdAt: lastCreatedAt } = 
    query.cursor ? decodeCursor(query.cursor) : { id: null, createdAt: null };
  
  const rows = await db.query(`
    SELECT * FROM orders
    WHERE region_code = $1 
      AND (created_at < $2 OR (created_at = $2 AND id > $3))
    ORDER BY created_at DESC, id ASC
    LIMIT $4
  `, [regionCode, lastCreatedAt, lastId, limit + 1]);
  
  const hasMore = rows.length > limit;
  const results = rows.slice(0, limit);
  
  const nextCursor = hasMore ? encodeCursor(results[results.length - 1]) : null;
  
  return { results, nextCursor };
}
```

### Rule 7: Batch Operations

For bulk inserts/updates:
```typescript
async insertOrderItems(items: OrderItem[]): Promise<void> {
  const placeholders = items.map((_, i) => 
    `($1, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5}, $${i*5+6})`
  ).join(', ');
  
  const params = [regionCode, ...items.flatMap(item => [
    item.orderId, item.productId, item.quantity, item.price, item.subtotal
  ])];
  
  await db.query(`
    INSERT INTO order_items 
    (region_code, order_id, product_id, quantity, price_per_unit, subtotal)
    VALUES ${placeholders}
  `, params);
}
```

---

## 7. API Contracts & DTOs

### Request DTOs (app/*/dto.ts)

#### CreateOrderRequest
```typescript
export class CreateOrderRequest {
  @IsUUID()
  restaurantId!: string;

  @IsArray()
  @ValidateNested()
  @Type(() => OrderItemInput)
  items!: OrderItemInput[];

  @IsOptional()
  @IsUUID()
  srcAccId?: string;  // null for system orders

  @IsString()
  @IsIn(['USD', 'EUR', 'EGP'])
  currency!: string;

  @IsString()
  @IsIn(['KASHIER', 'COD'])
  paymentMethod!: string;

  @IsString()
  @Length(2, 10)
  regionCode!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class OrderItemInput {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsDecimal()
  price!: string;
}
```

#### CreatePaymentRequest
```typescript
export class CreatePaymentRequest {
  @IsUUID()
  orderId!: string;

  @IsString()
  @IsIn(['KASHIER', 'COD'])
  paymentMethod!: string;

  @IsString()
  returnUrl!: string;

  @IsString()
  cancelUrl!: string;

  @IsString()
  @Length(2, 10)
  regionCode!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
```

### Response DTOs (app/*/dto.ts)

#### OrderResponse
```typescript
export class OrderResponse {
  orderId!: string;
  status!: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
  totalAmount!: number;
  currency!: string;
  items!: OrderItemResponse[];
  createdAt!: string;  // ISO 8601
  updatedAt!: string;
}

export class OrderItemResponse {
  itemId!: string;
  productId!: string;
  quantity!: number;
  pricePerUnit!: number;
  subtotal!: number;
}
```

#### CreateOrderResponse
```typescript
export class CreateOrderResponse {
  orderId!: string;
  status!: 'PENDING';
  totalAmount!: number;
  currency!: string;
  createdAt!: string;
}
```

#### CreatePaymentResponse
```typescript
export class CreatePaymentResponse {
  paymentId!: string;
  kashierSessionUrl!: string;
  status!: 'PENDING';
  createdAt!: string;
}
```

#### KashierWebhookPayload (Internal)
```typescript
export class KashierWebhookPayload {
  paymentId!: string;
  kashierPaymentId!: string;
  status!: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  amount!: number;
  currency!: string;
  metadata?: Record<string, any>;
  processedAt!: string;
}
```

### WebSocket Events

#### Subscription (Client → Server)
```typescript
// Connect
socket.emit('subscribe_order', {
  orderId: 'uuid',
  regionCode: 'US'
});

// Listen for events
socket.on('order_event', (event) => {
  console.log(event);
  // { orderId, eventType: 'ORDER_CREATED', payload: {...} }
});
```

#### Broadcast Events (Server → Client)
```typescript
// ORDER_CREATED
{
  orderId: 'uuid',
  eventType: 'ORDER_CREATED',
  payload: {
    status: 'PENDING',
    totalAmount: 23.50,
    createdAt: '2026-04-21T...'
  }
}

// PAYMENT_UPDATED
{
  orderId: 'uuid',
  eventType: 'PAYMENT_UPDATED',
  payload: {
    paymentId: 'uuid',
    status: 'SUCCESS',
    processedAt: '2026-04-21T...'
  }
}

// DELIVERY_ASSIGNED
{
  orderId: 'uuid',
  eventType: 'DELIVERY_ASSIGNED',
  payload: {
    assignmentId: 'uuid',
    deliveryAgentId: 'uuid',
    assignedAt: '2026-04-21T...'
  }
}

// ORDER_STATUS_CHANGED
{
  orderId: 'uuid',
  eventType: 'ORDER_STATUS_CHANGED',
  payload: {
    newStatus: 'PREPARING',
    updatedAt: '2026-04-21T...'
  }
}
```

---

## 8. Security & Compliance

### Authentication & Authorization

#### JWT Token Structure
```json
{
  "sub": "user_uuid",
  "accountType": "CUSTOMER|RESTAURANT|DELIVERY_AGENT|ADMIN",
  "regionCode": "US",
  "iat": 1234567890,
  "exp": 1234571490,
  "iss": "core-service"
}
```

#### Middleware: Auth Validation
```typescript
// app/middleware/auth.ts
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    throw new UnauthorizedError('Missing token');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    throw new UnauthorizedError('Invalid token');
  }
};
```

#### Authorization: Route Protection
```typescript
// Only customers can create orders
@Post()
@UseGuards(AuthGuard, AccountTypeGuard('CUSTOMER'))
async createOrder(@Body() dto: CreateOrderRequest) { }

// Only restaurants can accept orders
@Put('/:orderId/accept')
@UseGuards(AuthGuard, AccountTypeGuard('RESTAURANT'))
async acceptOrder(@Param('orderId') orderId: string) { }

// Only admins can view all orders
@Get('/admin/all')
@UseGuards(AuthGuard, AccountTypeGuard('ADMIN'))
async getAllOrders() { }
```

### Kashier Webhook Security

#### Signature Verification
```typescript
// lib/crypto/hmac.ts
import crypto from 'crypto';

export function verifyKashierSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}

// app/payments/webhooks.ts
@Post('/kashier-webhook')
async handleKashierWebhook(
  @RawBody() payload: string,
  @Headers('x-kashier-signature') signature: string
) {
  // Verify before processing
  if (!verifyKashierSignature(payload, signature, KASHIER_SECRET)) {
    throw new BadRequestError('Invalid signature');
  }

  const data = JSON.parse(payload) as KashierWebhookPayload;
  await this.paymentService.handleWebhook(data);
  
  return { status: 'ok' };
}
```

### Sensitive Data Handling

| Data | Storage | Transmission | Logging |
|------|---------|--------------|---------|
| **Kashier Secret** | `settings.json` (env var only) | TLS 1.3 | Never |
| **JWT Token** | Redis session store | TLS 1.3 header | Hash only |
| **Order Address** | JSONB in DB | TLS 1.3 | Never full address |
| **Payment Status** | Encrypted column (optional) | TLS 1.3 | Yes, redacted |

### GDPR & Data Retention

- **Customer PII**: Retained per local laws; purge after 6 months inactivity
- **Payment Data**: Retained per PCI-DSS (3 years minimum)
- **Audit Logs**: Retained 90 days; archived to cold storage
- **Order History**: Accessible for 1 year; moved to archive DB after

---

## 9. Idempotency & Reliability

### Idempotency Pattern (Distributed Locks)

**Problem**: Client retries `POST /orders` → duplicate orders created

**Solution**: Idempotency keys stored in Redis with full response

```typescript
// lib/cache/idempotency.ts
export class IdempotencyCache {
  async getOrExecute<T>(
    idempotencyKey: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 300
  ): Promise<T> {
    const cached = await redis.get(`idempotency:${idempotencyKey}`);
    if (cached) return JSON.parse(cached);

    // Lock to prevent concurrent execution
    const lockKey = `idempotency:lock:${idempotencyKey}`;
    const lockAcquired = await redis.set(lockKey, '1', 'PX', 5000, 'NX');
    
    if (!lockAcquired) {
      // Wait for concurrent request to finish
      let attempts = 0;
      while (attempts < 10) {
        const result = await redis.get(`idempotency:${idempotencyKey}`);
        if (result) return JSON.parse(result);
        await sleep(100);
        attempts++;
      }
      throw new ConflictError('Idempotent request in progress');
    }

    try {
      const result = await fn();
      await redis.setex(`idempotency:${idempotencyKey}`, ttlSeconds, JSON.stringify(result));
      return result;
    } finally {
      await redis.del(lockKey);
    }
  }
}

// Usage in controller
@Post()
async createOrder(@Body() dto: CreateOrderRequest) {
  return this.idempotencyCache.getOrExecute(
    dto.idempotencyKey || uuidv4(),
    () => this.orderService.createOrder(dto),
    300  // 5 min TTL
  );
}
```

### Webhook Idempotency (Version Column)

**Problem**: Kashier sends webhook twice → payment marked as SUCCESS twice

**Solution**: Optimistic locking with version column

```typescript
// app/payments/webhooks.ts
async handleKashierWebhook(payload: KashierWebhookPayload) {
  // Acquire lock
  const lockKey = `lock:webhook:kashier:${payload.kashierPaymentId}`;
  const lockAcquired = await redis.set(lockKey, '1', 'PX', 2000, 'NX');
  
  if (!lockAcquired) {
    // Already processing → return 200 (idempotent)
    return { status: 'ok' };
  }

  try {
    await this.paymentService.updatePaymentStatus(
      payload.paymentId,
      payload.status,
      payload.version  // Optimistic lock
    );
  } finally {
    await redis.del(lockKey);
  }
}

// Repository: Optimistic lock update
async updatePaymentStatus(
  regionCode: string,
  paymentId: string,
  newStatus: string,
  expectedVersion: number
): Promise<void> {
  const result = await db.query(`
    UPDATE payments
    SET status = $1, version = version + 1, updated_at = NOW()
    WHERE region_code = $2 
      AND payment_id = $3 
      AND version = $4
  `, [newStatus, regionCode, paymentId, expectedVersion]);

  if (result.rowCount === 0) {
    throw new ConflictError('Payment version mismatch (already updated)');
  }
}
```

---

## 10. Error Handling

### Error Hierarchy

```typescript
// lib/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, public serviceName: string) {
    super(message, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}
```

### Global Error Handler

```typescript
// app/middleware/errorHandler.ts
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const logger = req.app.get('logger');
  const traceId = req.traceId;

  if (err instanceof AppError) {
    logger.warn('AppError', {
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      traceId,
      details: err.details
    });

    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  // Unhandled error
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    traceId
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      traceId
    }
  });
};

// Register globally
app.use(errorHandler);
```

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid order: amount must be > 0",
    "details": {
      "field": "totalAmount",
      "constraint": "positive",
      "value": -10
    }
  }
}
```

---

## 11. Testing Guidelines

### Unit Tests (with Mocked Dependencies)

```typescript
// test/unit/orders/order.service.spec.ts
import { OrderService } from '../../../pkg/order/service';
import { OrderRepository } from '../../../pkg/order/repository';

describe('OrderService.createOrder', () => {
  let service: OrderService;
  let mockOrderRepo: jest.Mocked<OrderRepository>;

  beforeEach(() => {
    mockOrderRepo = {
      insert: jest.fn(),
      findById: jest.fn(),
      // ... other methods
    } as any;

    service = new OrderService(mockOrderRepo, mockLogger);
  });

  it('should create order with valid request', async () => {
    // Arrange
    const dto = new CreateOrderRequest();
    dto.restaurantId = 'rest-123';
    dto.items = [{ productId: 'prod-123', quantity: 2, price: '10.00' }];
    dto.regionCode = 'US';

    const expectedOrder = new Order(
      'order-123',
      'US',
      'cust-123',
      'rest-123',
      OrderStatus.PENDING,
      Decimal.from('20.00'),
      [],
      new Date()
    );

    mockOrderRepo.insert.mockResolvedValue(expectedOrder);

    // Act
    const result = await service.createOrder(dto);

    // Assert
    expect(result.id).toBe('order-123');
    expect(result.status).toBe(OrderStatus.PENDING);
    expect(mockOrderRepo.insert).toHaveBeenCalled();
  });

  it('should throw ValidationError if amount is negative', async () => {
    // Arrange
    const dto = new CreateOrderRequest();
    dto.totalAmount = -10;

    // Act & Assert
    await expect(service.createOrder(dto))
      .rejects
      .toThrow(ValidationError);
  });
});
```

### Integration Tests (Docker Compose)

```typescript
// test/integration/orders.e2e.ts
import { createTestApp } from '../fixtures/app-factory';
import { connectTestDb, resetTestDb } from '../fixtures/db-setup';

describe('Orders API (E2E)', () => {
  let app: Express;
  let db: Pool;

  beforeAll(async () => {
    app = await createTestApp();
    db = await connectTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
  });

  afterAll(async () => {
    await db.end();
  });

  it('POST /api/v1/orders should create order', async () => {
    // Act
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${testJWT}`)
      .send({
        restaurantId: 'rest-123',
        items: [{ productId: 'prod-123', quantity: 2, price: '10.00' }],
        regionCode: 'US'
      });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.orderId).toBeDefined();
    expect(response.body.status).toBe('PENDING');

    // Verify DB
    const order = await db.query('SELECT * FROM orders WHERE order_id = $1', [
      response.body.orderId
    ]);
    expect(order.rows).toHaveLength(1);
  });
});
```

### Test Configuration

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: order_service_test
      POSTGRES_PASSWORD: test
    ports:
      - "5433:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"
```

---

## 12. Communication Patterns

### Synchronous: Order Service → Core Service

**Use Cases**: Validate user/restaurant existence, fetch delivery agent

```typescript
// lib/http/coreServiceClient.ts
export class CoreServiceClient {
  constructor(private httpClient: HttpClient) {}

  async validateCustomer(userId: string): Promise<CustomerDTO> {
    try {
      const response = await this.httpClient.get(
        `/api/v1/users/${userId}`,
        { timeout: 2000, retries: 2 }
      );
      return response.data;
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new ExternalServiceError('Core service timeout', 'core-service');
      }
      throw err;
    }
  }

  async validateRestaurant(restaurantId: string): Promise<RestaurantDTO> {
    const response = await this.httpClient.get(
      `/api/v1/restaurants/${restaurantId}`,
      { timeout: 2000, retries: 2 }
    );
    return response.data;
  }
}
```

**Circuit Breaker Pattern**: Prevent cascade failures

```typescript
// Usage
const breaker = new CircuitBreaker(async () => {
  return await coreServiceClient.validateCustomer(userId);
}, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});

try {
  const customer = await breaker.fire();
} catch (err) {
  if (err instanceof CircuitBreaker.OpenError) {
    throw new ServiceUnavailableError('Core service unavailable');
  }
}
```

### Asynchronous: Event Publishing (Kafka)

**Use Cases**: Audit logs, analytics, downstream notifications

```typescript
// lib/events/publisher.ts
export class EventPublisher {
  async publishOrderCreated(order: Order): Promise<void> {
    const event = {
      eventId: uuidv4(),
      eventType: 'order.created',
      orderId: order.id,
      regionCode: order.regionCode,
      payload: {
        restaurantId: order.restaurantId,
        totalAmount: order.totalAmount,
        items: order.items.length,
        createdAt: order.createdAt.toISOString()
      },
      timestamp: new Date().toISOString()
    };

    await kafka.send({
      topic: 'core-events',
      messages: [{
        key: order.id,
        value: JSON.stringify(event),
        headers: {
          'content-type': 'application/json',
          'correlation-id': request.traceId
        }
      }]
    });
  }
}
```

---

## 13. WebSocket & Real-Time Updates

### Architecture: PostgreSQL LISTEN/NOTIFY → Socket.io

```typescript
// lib/events/pgNotifier.ts
export class PgNotifier {
  private notificationClient: pg.Client;
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();

  async subscribe(channel: string, callback: (payload: any) => void): Promise<void> {
    await this.notificationClient.query(`LISTEN ${channel}`);
    
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);
  }

  async start(): Promise<void> {
    this.notificationClient.on('notification', (msg) => {
      const listeners = this.listeners.get(msg.channel);
      if (listeners) {
        const payload = JSON.parse(msg.payload);
        listeners.forEach(callback => callback(payload));
      }
    });
  }
}

// app/websocket/handler.ts
export class WebSocketHandler {
  constructor(
    private pgNotifier: PgNotifier,
    private orderService: OrderService
  ) {}

  handleConnection(socket: Socket): void {
    const userId = socket.handshake.auth.userId;
    const regionCode = socket.handshake.auth.regionCode;

    // Subscribe to order updates
    socket.on('subscribe_order', async (orderId: string) => {
      const room = `order:${orderId}:${regionCode}`;
      socket.join(room);

      // Subscribe to PostgreSQL channel
      const channel = `order_events_${regionCode}`;
      this.pgNotifier.subscribe(channel, (event) => {
        if (event.orderId === orderId) {
          socket.emit('order_event', event);
        }
      });
    });

    socket.on('disconnect', () => {
      // Cleanup
    });
  }
}
```

### Emitting Events from Services

```typescript
// pkg/order/service.ts
export class OrderService {
  constructor(
    private orderRepo: OrderRepository,
    private eventPublisher: EventPublisher
  ) {}

  async createOrder(dto: CreateOrderRequest): Promise<Order> {
    const order = new Order(...);
    
    // Save order
    await this.orderRepo.insert(order);

    // Emit event (async, fire-and-forget)
    this.eventPublisher.publishOrderCreated(order).catch(err => {
      logger.error('Failed to publish order event', err);
    });

    return order;
  }
}
```

---

## 14. Constraints & Non-Functional Requirements

### Performance Targets (SLA)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Order Creation Latency** | <500ms p99 | End-to-end HTTP request |
| **Order Retrieval Latency** | <100ms p99 | Cached response |
| **Payment Webhook Processing** | <1s p99 | Webhook received → DB updated |
| **WebSocket Event Delivery** | <500ms | Event inserted → client received |
| **Cache Hit Rate** | >85% | Ratio of cache hits to total reads |

### Scalability Targets (Per Region)

| Metric | Target |
|--------|--------|
| **Peak RPS** | 10,000 (lunch hours) |
| **Concurrent WebSocket Connections** | 100,000 |
| **DB Connection Pool Size** | 20-30 |
| **Redis Memory Usage** | <5GB (TTL auto-eviction) |
| **Disk I/O (DB)** | <80% utilization |

### Availability & Reliability

| Metric | Target |
|--------|--------|
| **API Availability** | 99.9% SLA |
| **Data Durability** | RPO = 0 (synchronous replication) |
| **Recovery Time** | RTO = <5 min (automated failover) |
| **Order Delivery Guarantee** | At-least-once (idempotent processing) |

### Consistency Model

| Data | Consistency | Reasoning |
|------|-----------|-----------|
| **Orders** | Strong (within shard) | ACID transactions per region |
| **Payments** | Strong | Financial data: immediate accuracy |
| **Delivery Status** | Eventual (< 5s) | Real-time updates via WebSocket |
| **Analytics** | Eventual | Aggregations in separate service |

### Multi-Region Compliance

- **Data Residency**: No cross-region writes; queries filter `region_code` first
- **Latency**: Regional DB per shard; <100ms p95 local read
- **Failover**: Standby DB in secondary AZ; <30s to promotion
- **Backup**: Daily snapshots; 30-day retention

---

## 15. Implementation Roadmap

### Phase 1: Database Foundation (Week 1)
- [ ] Create PostgreSQL schema (orders, order_items, payments, delivery_assignments, order_events)
- [ ] Set up partitioning by region_code
- [ ] Create indexes (query-driven)
- [ ] Write migrations (Flyway/Knex)
- [ ] Test with testcontainers

### Phase 2: Orders Module (Week 2-3)
- [ ] Define Order entity (`pkg/order/entity.ts`)
- [ ] Implement OrderRepository interface (`pkg/order/repository.ts`)
- [ ] Implement OrderService (creation, state transitions) (`pkg/order/service.ts`)
- [ ] Create DTOs (Request/Response) (`app/orders/dto.ts`)
- [ ] Build OrderController (`app/orders/controller.ts`)
- [ ] Add validation middleware
- [ ] Unit & integration tests

### Phase 3: Payments Module (Week 3-4)
- [ ] Define Payment entity (`pkg/payment/entity.ts`)
- [ ] Implement PaymentRepository (`pkg/payment/repository.ts`)
- [ ] Integrate Kashier API (`lib/http/kashierClient.ts`)
- [ ] Implement PaymentService (session creation, webhook) (`pkg/payment/service.ts`)
- [ ] Create webhook handler (`app/payments/webhooks.ts`)
- [ ] Add signature verification (HMAC)
- [ ] Handle idempotency (locks, versioning)
- [ ] Unit & integration tests

### Phase 4: Delivery Module (Week 4)
- [ ] Define DeliveryAssignment entity (`pkg/delivery/entity.ts`)
- [ ] Implement DeliveryAssignmentRepository (`pkg/delivery/repository.ts`)
- [ ] Implement DeliveryService (assignment, status updates) (`pkg/delivery/service.ts`)
- [ ] Create DeliveryController (`app/delivery/controller.ts`)
- [ ] Test with core-service mocks

### Phase 5: WebSocket & Real-Time (Week 5)
- [ ] Set up PostgreSQL LISTEN/NOTIFY (`lib/events/pgNotifier.ts`)
- [ ] Implement Socket.io handler (`app/websocket/handler.ts`)
- [ ] Emit events from all services
- [ ] Add authentication to WebSocket
- [ ] Test with multiple concurrent clients

### Phase 6: Caching & Performance (Week 5)
- [ ] Implement Redis cache (`lib/cache/redis.ts`)
- [ ] Add cache-aside for orders, payments
- [ ] Implement idempotency cache
- [ ] Add circuit-breaker for external calls
- [ ] Load testing with k6

### Phase 7: Testing & Documentation (Week 6)
- [ ] Complete unit test coverage (>80%)
- [ ] Write integration tests (end-to-end flows)
- [ ] Generate OpenAPI spec (`docs/api_contracts.md`)
- [ ] Document error codes
- [ ] Runbooks for on-call

### Phase 8: Security & DevOps (Week 7+, ongoing)
- [ ] OWASP compliance review
- [ ] Penetration testing
- [ ] Build CI/CD pipeline (GitHub Actions)
- [ ] Deploy to staging
- [ ] Load test with production traffic shape
- [ ] Security audit with DevOps team

---

## Code Quality Standards

### Linting & Formatting
```bash
# ESLint
npm run lint

# Prettier (auto-format)
npm run format

# Type checking
npm run type-check
```

### Coverage Thresholds
- **Statements**: >80%
- **Branches**: >75%
- **Functions**: >80%
- **Lines**: >80%

### Pre-Commit Hooks
```bash
# .husky/pre-commit
npm run lint
npm run type-check
npm test -- --bail --onlyChanged
```

---

## Monitoring & Observability

### Structured Logging (JSON)

```json
{
  "timestamp": "2026-04-21T14:32:10Z",
  "level": "INFO",
  "service": "order-service",
  "traceId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "order_created",
  "orderId": "550e8400-e29b-41d4-a716-446655440001",
  "regionCode": "US",
  "restaurantId": "550e8400-e29b-41d4-a716-446655440002",
  "duration_ms": 145
}
```

### Metrics (Prometheus)

```typescript
// lib/metrics/index.ts
const orderCreationDuration = new Histogram({
  name: 'order_creation_duration_seconds',
  help: 'Time to create an order',
  labelNames: ['region', 'payment_method']
});

const paymentWebhookProcessing = new Histogram({
  name: 'payment_webhook_processing_duration_seconds',
  help: 'Time to process Kashier webhook',
  labelNames: ['status']
});

const cacheHitRate = new Counter({
  name: 'cache_hits_total',
  labelNames: ['entity', 'region']
});
```

### Alerting Rules

```yaml
# Alert on high order creation latency
alert: HighOrderCreationLatency
expr: histogram_quantile(0.99, order_creation_duration_seconds) > 1
for: 5m
annotations:
  summary: "Order creation latency > 1s (p99)"

# Alert on payment webhook failures
alert: PaymentWebhookFailures
expr: rate(payment_webhook_errors_total[5m]) > 0.01
for: 5m
annotations:
  summary: "Payment webhook error rate > 1%"
```

---

## Summary

This Order Service follows **clean architecture** principles with strict layer isolation (`app/` → `pkg/` → `lib/`), implements **sharding by region** for horizontal scalability, and uses **proven patterns** (cache-aside, idempotency, circuit-breaker) to handle high traffic.

**Key Takeaways**:
1. **Sharding First**: All queries filter `region_code` first
2. **No N+1**: Use JOINs or batch queries
3. **Indexes Are Query-Driven**: No random indexes
4. **Idempotency**: Store keys in Redis for deduplication
5. **Security**: Validate signatures, use JWT, TLS everywhere
6. **Testing**: Unit + integration with Docker Compose
7. **Observability**: Structured JSON logs, Prometheus metrics
8. **Performance**: Cache with short TTLs, use circuit-breakers

**All new code must follow these guidelines. Deviations must be documented and approved by the architecture owner.**

---

*Last Updated: 2026-04-22*  
*Maintained By: QuickBite Platform Team*

