---
name: Documentation Index & Quick Start
description: Index of all Order Service documentation and quick reference guide
---

# Order Service - Documentation Index & Quick Start

## 📚 Documentation Overview

This Order Service is comprehensively documented to serve as a reference for developers, architects, and operators. Below is a guide to navigate all documentation.

---

## 🚀 Quick Navigation by Role

| Role | Start Here | Time | Next Steps |
|------|-----------|------|-----------|
| **Backend Developer** | `../claude.md` (30 min) | 30 min | → `database_design.md` (20 min) → `folder_structure.md` (15 min) → Pick a module |
| **DevOps / Infrastructure** | `system_design.md` (20 min) | 20 min | → `database_design.md` (20 min) → `implementation_plan.md` Phase 1 |
| **Architect / Tech Lead** | `../../full_PRD.md` (30 min) | 30 min | → `system_design.md` (20 min) → `../claude.md` → `implementation_plan.md` |
| **QA / Testing** | `api_contracts.md` (30 min) | 30 min | → Module docs → `implementation_plan.md` (testing sections) |
| **Frontend Developer** | `api_contracts.md` (30 min) | 30 min | → Example curl commands in each endpoint |

---

## 📖 Core Documentation Files (In Priority Order)

### 1. **../claude.md** - Project Guidelines & Technical Standards ⭐⭐⭐
   **Read This FIRST on day 1**
   
   - **Purpose**: Central reference for ALL code, architecture, and operational standards
   - **Audience**: All engineers
   - **Key Sections**:
     1. Architectural Overview – External systems, service boundaries, communication patterns
     2. Folder Structure – How `lib/`, `pkg/`, and `app/` differ (CRITICAL for code reviews)
     3. Naming Conventions – Database, code, API routes, Redis keys
     4. Database Design – Sharding by `region_code`, why composite PKs, index strategy
     5. Layered Architecture – HTTP → DTO → Service → Repository → Database (with code examples)
     6. Performance Rules – No N+1 queries, caching patterns, pagination, batch operations
     7. API Contracts – How to structure DTOs and responses
     8. Security – JWT validation, Kashier webhook verification, CORS
     9. Idempotency – Request deduplication, Redis storage strategy
     10. Error Handling – Exception types, HTTP status codes, error response format
     11. Testing – Unit, integration, E2E, coverage targets (>80%)
     12. Communication Patterns – Sync (2s timeout), async (Kafka), circuit breakers
     13. WebSocket Architecture – Socket.io + PostgreSQL LISTEN/NOTIFY
     14. Non-Functional Requirements – Latency targets, throughput, availability SLAs
   
   - **Critical Rules** (Enforce in Code Review):
     ✓ Every table has `region_code` as first column of composite primary key
     ✓ No cross-layer imports (lib must not import app, pkg must not import app)
     ✓ All external HTTP calls have 2-5s timeout and 3x retry logic
     ✓ Redis is cache-aside only (not write-through)
     ✓ NO N+1 queries – always use JOINs or batch fetches
     ✓ Pagination is cursor-based for scalability
     ✓ All POST/PATCH endpoints accept `Idempotency-Key` header

### 2. **database_design.md** - Database Schema & Region Sharding
   **Read before writing queries**
   
   - **Purpose**: Database schema reference, indexes, constraints, partitioning strategy
   - **Audience**: Backend developers, DBAs, DevOps
   - **Key Sections**:
     1. Core Tables – `orders`, `order_items`, `payments`, `delivery_assignments`, `order_events`
     2. Column Definitions – Types, constraints, examples
     3. Sharding Strategy – How regions map to PostgreSQL schemas
     4. Indexes (Query-Driven) – Created only when justified by query patterns:
        - Orders: `(region_code, src_acc_id, created_at DESC)` for customer lookup
        - Orders: `(region_code, dst_acc_id, created_at DESC)` for restaurant lookup
        - Orders: `(region_code, order_status)` for filtering by status
        - Payments: `(region_code, kashier_payment_id)` UNIQUE for webhook idempotency
        - Delivery: `(region_code, delivery_agent_id, status)` for agent lookup
        - Events: `(region_code, order_id, created_at DESC)` for WebSocket event replay
     5. Foreign Key Constraints – With ON DELETE behavior
     6. Partitioning Strategy – PostgreSQL declarative partitioning per region
     7. Migration Procedures – How to add new regions, update schemas safely
     8. Monitoring Queries – Table sizes, index usage statistics
   
   - **Golden Rules**:
     ✓ Every query filters by `region_code` FIRST (enables partition pruning)
     ✓ Indexes are created per-shard (PostgreSQL partition-level)
     ✓ Only create indexes based on actual query patterns (measured with EXPLAIN ANALYZE)
     ✓ FK constraints reference core_service tables (cross-database, app-level validation)
     ✓ ON DELETE CASCADE for order_items, payments, delivery_assignments (children auto-delete)

### 3. **folder_structure.md** - Project Layout & Naming Conventions
   **Read when creating new files**
   
   - **Purpose**: Directory structure template, naming conventions, layer isolation rules
   - **Audience**: Backend developers, code reviewers
   - **Structure**:
     ```
     Order-Service/
     ├── src/
     │   ├── app/                        # HTTP layer (controllers, DTOs, middleware)
     │   │   ├── orders/
     │   │   │   ├── controller.ts       # REST endpoints
     │   │   │   ├── dto.ts              # CreateOrderRequest, OrderResponse
     │   │   │   └── routes.ts           # Express router
     │   │   ├── payments/
     │   │   ├── delivery/
     │   │   ├── middleware/             # Auth, validation, error handling
     │   │   └── server.ts               # Express initialization
     │   ├── pkg/                        # Domain layer (entities, business logic)
     │   │   ├── order/
     │   │   │   ├── entity.ts           # Order class (state machine)
     │   │   │   ├── types.ts            # OrderStatus enum, constants
     │   │   │   ├── service.ts          # Business logic (validation, transitions)
     │   │   │   └── repository.ts       # Interface (abstraction)
     │   │   ├── payment/
     │   │   └── delivery/
     │   └── lib/                        # Reusable utilities (NO app awareness)
     │       ├── db/                     # DB connection, sharding, migrations
     │       ├── http/                   # HTTP clients, retry logic, circuit breakers
     │       ├── cache/                  # Redis wrappers
     │       └── events/                 # PostgreSQL LISTEN/NOTIFY
     ├── test/
     │   ├── unit/                       # Unit tests (mocked dependencies)
     │   ├── integration/                # Integration tests (real DB/Redis)
     │   └── fixtures/                   # Test data factories
     └── docs/                           # This folder
     ```
   
   - **Naming Conventions**:
     | Element | Pattern | Example |
     |---------|---------|---------|
     | Package folder | lowercase, singular | `orders`, `payments` |
     | DTO class | PascalCase + (Request\|Response) | `CreateOrderRequest`, `OrderResponse` |
     | Entity class | PascalCase matching table | `Order`, `Payment` |
     | Repository interface | `<Entity>Repository` | `OrderRepository` |
     | Service class | `<Entity>Service` | `OrderService` |
     | Controller | `<Entity>Controller` | `OrderController` |
     | SQL columns | snake_case | `order_id`, `region_code` |
     | DB indexes | `idx_<table>_<cols>` | `idx_orders_status_created_at` |
     | Foreign keys | `fk_<child>_<parent>` | `fk_orders_src_acc_id_users` |
     | Redis keys | `<entity>:<region>:<id>` | `order:US:3fa85f64-5717-4562-b3fc` |

### 4. **api_contracts.md** - REST & WebSocket API Specification
   **Read before calling any endpoint**
   
   - **Purpose**: OpenAPI specification for all endpoints, request/response examples, error codes
   - **Audience**: Frontend developers, QA, API consumers
   - **Endpoints Defined**:
     - **Orders**: POST /orders, GET /orders/:id, GET /orders, PUT /orders/:id/status, DELETE /orders/:id
     - **Payments**: POST /payments, GET /payments/:id, POST /payments/kashier-webhook (webhook)
     - **Delivery**: POST /delivery/assign, PUT /delivery/:id/status, GET /delivery/pending
     - **WebSocket**: `ws://host/api/v1/orders/stream?region=XX`
   
   - **Every Endpoint Includes**:
     ✓ Request body schema (with required/optional fields)
     ✓ Response schema (201/200/400/404/409/502)
     ✓ Authorization requirements (JWT claims, account type)
     ✓ Error codes with meaning (e.g., RESTAURANT_NOT_FOUND, INVALID_TRANSITION)
     ✓ Example curl commands (copy-paste ready)

### 5. **orders_module.md** - Orders Domain Implementation Guide
   **Read before implementing Order features**
   
   - **Purpose**: Detailed guide for Order entity, service, repository, DTOs, caching
   - **Sections**:
     1. High-level Responsibilities – What the Orders module owns
     2. DTOs – CreateOrderRequest, OrderResponse, detailed schemas
     3. Service Layer – createOrder(), getById(), updateStatus(), cancelOrder() methods
     4. Repository Layer – Data access patterns, batch operations
     5. Caching Strategy – Redis TTL, cache invalidation rules
     6. Communication – Sync calls to Core Service for validation
     7. WebSocket Integration – Which events Orders module publishes
     8. Error Handling & Idempotency – Request deduplication strategy

### 6. **payments_module.md** - Payments Domain Implementation Guide
   **Read before implementing Payment features**
   
   - **Purpose**: Kashier v3 integration, webhook handling, payment state machine
   - **Sections**:
     1. Kashier v3 API Details – Session creation, webhook format
     2. DTOs – CreatePaymentRequest, PaymentStatusResponse, WebhookPayload
     3. Service Layer – initiatePayment(), handleWebhook(), refundPayment()
     4. Signature Verification – HMAC-SHA256 with Kashier secret
     5. Webhook Idempotency – Redis locking to prevent duplicate processing
     6. Optimistic Locking – Version column to handle concurrent updates
     7. Error Codes – Kashier API errors mapped to HTTP status
     8. Security – Secret management, TLS, CSRF protection
   
   - **Critical**: 
     ✓ Webhook endpoint is PUBLIC (no JWT required)
     ✓ Always verify signature before processing
     ✓ Use Redis lock to prevent duplicate webhook processing
     ✓ Idempotent: same webhook called twice = processed only once

### 7. **delivery_agent_module.md** - Delivery Domain Implementation Guide
   **Read before implementing Delivery features**
   
   - **Purpose**: Delivery agent assignment, status tracking, availability
   - **Sections**:
     1. Responsibilities – Assign agents, track status, publish events
     2. DTOs – AssignAgentRequest, AssignAgentResponse, StatusUpdate
     3. Service Layer – assignAgent(), updateStatus(), listPending()
     4. State Transitions – ASSIGNED → PICKED_UP → DELIVERED (with allowed cancellation)
     5. Core Service Sync – Verify delivery agent exists before assignment
     6. Caching – Available agents cached for 30s
     7. Error Codes – Invalid transitions, agent not found

### 8. **system_design.md** - Architecture & Design Decisions
   **Read to understand WHY architectural choices were made**
   
   - **Purpose**: Justify design decisions, tradeoffs, alternatives considered
   - **Topics**:
     1. Sharding by Region – Why (scalability, latency), how (PostgreSQL partitioning)
     2. Redis Caching – Cache-aside pattern, TTLs
     3. Sync vs Async Communication – When to use HTTP (2s timeout) vs Kafka
     4. WebSocket Live Updates – PostgreSQL LISTEN/NOTIFY for event broadcasting
     5. Performance & N+1 Prevention – Batch fetches, JOIN strategies
     6. Transaction Boundaries – ACID guarantees per operation
     7. Idempotency – Why important for payment/order creation

### 9. **implementation_plan.md** - Phased Rollout (5 Weeks Total)
   **Read for project planning and task breakdown**
   
   - **Purpose**: Detailed step-by-step implementation roadmap with checklists
   - **Phases**:
     - **Phase 1 (Week 1)**: Database setup, migrations, partitioning, indexes
     - **Phase 2 (Week 2-3)**: Orders module (entity, service, controller, tests)
     - **Phase 3 (Week 3-4)**: Payments module (Kashier integration, webhooks)
     - **Phase 4 (Week 4)**: Delivery module (agent assignment, status tracking)
     - **Phase 5 (Week 5)**: WebSocket & real-time updates
   
   - **Each Phase Includes**:
     ✓ Detailed tasks with subtasks
     ✓ Definition of Done (DoD) checklist
     ✓ Testing strategy (unit, integration, E2E)
     ✓ Documentation updates
     ✓ Code coverage targets (>80%)

---

## 🔍 Documentation Map (Find What You Need)

### I want to...
- **...understand the overall architecture** → Start with `../claude.md` section 1 + `system_design.md`
- **...write a new API endpoint** → `folder_structure.md` (layout) → `api_contracts.md` (format) → module docs
- **...add a database query** → `database_design.md` (schema) → `../claude.md` section 4 (indexes)
- **...implement a new module** → `implementation_plan.md` (phases) → module-specific doc
- **...understand caching** → `../claude.md` section 6 + `orders_module.md` (caching strategy)
- **...implement Kashier webhook** → `payments_module.md` + `api_contracts.md` (webhook section)
- **...set up testing** → `implementation_plan.md` (testing sections) + `../claude.md` section 11
- **...add a new region** → `database_design.md` (migration notes) + `folder_structure.md` (sharding-aware code)

---

## 📋 Documentation Maintenance

This documentation is living and evolves with the codebase. When you:
- **Add a new endpoint** → Update `api_contracts.md` FIRST (write the spec before code)
- **Change DB schema** → Update `database_design.md` + migration files
- **Add new libraries** → Update `../claude.md` external dependencies section
- **Implement a new module** → Create `<module>_module.md` following this template
- **Discover a pattern** → Document it in `../claude.md` constraints section

---

## ✅ Checklist for New Team Members

- [ ] Read `../claude.md` (especially sections 1, 2, 3, 5)
- [ ] Read `database_design.md` (understand table structure and sharding)
- [ ] Read `folder_structure.md` (understand directory layout)
- [ ] Clone the repo and run `npm install && docker-compose up`
- [ ] Run tests: `npm test` (should pass)
- [ ] Pick one module (`orders`, `payments`, or `delivery`)
- [ ] Read the corresponding module doc
- [ ] Create a small feature branch and write code following the patterns
- [ ] Submit PR, get reviewed by tech lead

---

*Last updated: April 2026 | Maintainer: Tech Lead | Review Cycle: Monthly*
