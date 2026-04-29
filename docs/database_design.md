---
name: Database Design
description: Database schema, sharding strategy, indexes and constraints for the Order Service
type: reference
---

# Database Design

## Overview
The **order_service** database is a PostgreSQL instance sharded by **region**. Each region has its own schema (`region_us`, `region_eu`, …) that contains the same set of tables. Sharding key:
```
region_code VARCHAR(3) NOT NULL
```
All tables include this column and a composite primary key that starts with `region_code` to ensure rows are stored on the correct shard.

## Core Tables
| Table | Columns | Description |
|-------|---------|-------------|
| **orders** | `region_code` PK, `order_id` PK, `src_acc_id` (FK → core_service.users.id, nullable for system), `dst_acc_id` (FK → core_service.users.id), `restaurant_id` (FK → core_service.restaurants.id), `status` (enum), `total_amount` (numeric), `currency` (char(3)), `created_at`, `updated_at` | Main order record |
| **order_items** | `region_code` PK, `order_id` PK, `item_id` PK, `product_id` (FK → core_service.products.id), `quantity`, `price`, `created_at` | Items belonging to an order |
| **payments** | `region_code` PK, `payment_id` PK, `order_id` FK → orders, `kashier_payment_id` VARCHAR, `status` (enum), `amount`, `currency`, `processed_at` | Payment information created via Kashier v3 |
| **delivery_assignments** | `region_code` PK, `assignment_id` PK, `order_id` FK → orders, `delivery_agent_id` (FK → core_service.delivery_agents.id), `assigned_at`, `status` (enum) | Assignment of a delivery agent |
| **order_events** | `region_code` PK, `event_id` PK, `order_id` FK → orders, `event_type` (enum), `payload` JSONB, `created_at` | Event log for websocket pushes |

## Sharding Strategy
* Every table contains `region_code` as the first column of the primary key.
* Application code determines the target shard based on the order’s **restaurant** region or the user’s preferred region.
* Connection pooling per region is configured in `pkg/db` – a factory returns a `*sql.DB` tied to the appropriate schema.

## Indexes (created per shard)
* `orders` – composite PK `(region_code, order_id)`. Additional B‑tree index on `(region_code, status, created_at)` for status‑based lookup.
* `order_items` – PK `(region_code, order_id, item_id)`. Index on `(region_code, product_id)` for sales analytics.
* `payments` – PK `(region_code, payment_id)`. Unique index on `(region_code, kashier_payment_id)`.
* `delivery_assignments` – PK `(region_code, assignment_id)`. Index on `(region_code, delivery_agent_id, status)`.
* `order_events` – PK `(region_code, event_id)`. Index on `(region_code, order_id, created_at)` for websocket replay.

## Foreign‑Key Constraints
* `orders.src_acc_id` → `core_service.users.id` (ON DELETE SET NULL). Nullable for system‑generated orders.
* `orders.dst_acc_id` → `core_service.users.id` (ON DELETE RESTRICT).
* `orders.restaurant_id` → `core_service.restaurants.id` (ON DELETE RESTRICT).
* `order_items.product_id` → `core_service.products.id` (ON DELETE RESTRICT).
* `payments.order_id` → `orders(order_id)` (ON DELETE CASCADE).
* `delivery_assignments.order_id` → `orders(order_id)` (ON DELETE CASCADE).

## Partitioning & Performance
* Tables are **partitioned by `region_code`** using PostgreSQL declarative partitioning – each region becomes a child table.
* Queries always filter by `region_code`, enabling partition pruning and eliminating cross‑region scans.
* No N+1 queries: services load related rows with `JOIN`s or `IN` batch fetching.
* All JSONB columns (`payload` in `order_events`) are queried with appropriate GIN indexes when needed.

## Hot/Cold Database Archival Strategy

**Per PRD Section 9 – Data Retention:**
- **Hot Database** (`order_service`): Contains only current-year data. All application queries target this database.
- **Cold Archive Databases** (`order_service_archive_<YYYY>`): Contains prior-year data, retained for compliance and long-term auditing.

### Archive Database Schema
- Archive databases use the **identical schema** as the hot database, with the same tables (`orders`, `order_items`, `payments`, `delivery_assignments`, `order_events`).
- Each archive DB is partitioned by `region_code` to maintain consistency with the hot DB structure.
- Archive DBs use **read-only credentials** and lower IOPS settings (cold storage tier).

### Archival Process
1. **Annual Migration** (typically end-of-year or early January):
   - Nightly batch job runs: `COPY` all rows where `EXTRACT(YEAR FROM created_at) < CURRENT_YEAR` to archive DB
   - Archive DB naming convention: `order_service_archive_2024`, `order_service_archive_2025`, etc.
   - Verification: Count rows in both databases to ensure completeness
   - Delete archived rows from hot DB to reclaim space

2. **Performance Impact**:
   - Hot DB remains lean (~146 GB per year per PRD)
   - Indexes stay efficient; query plans remain optimal
   - No scanning of historical data in production queries

### Application Behavior
- **Query Filter**: All application queries must include `WHERE created_at >= DATE_TRUNC('year', NOW())` to ensure hot DB-only access
- **No Historical Reads**: Production API endpoints serve only current-year data
- **Archive Access**: Historical data is accessed only by:
  - Customer service teams (via separate admin portal with archive DB credentials)
  - Financial audits & reconciliation tools
  - Compliance reporting systems
- **Connection Pooling**: Separate connection pool for archive DBs (read-only, lower concurrency)

### Example Query Patterns

**Hot DB Query (Current Year)**:
```sql
SELECT o.*, oi.* 
FROM orders o
LEFT JOIN order_items oi ON o.order_id = oi.order_id 
WHERE o.region_code = 'US'
  AND o.created_at >= DATE_TRUNC('year', NOW())
  AND o.status = 'DELIVERED'
ORDER BY o.created_at DESC;
```

**Archive DB Query (Historical, via separate connection)**:
```sql
-- Connected to order_service_archive_2024
SELECT o.*, oi.* 
FROM orders o
LEFT JOIN order_items oi ON o.order_id = oi.order_id 
WHERE o.region_code = 'US'
  AND o.created_at >= '2024-01-01' AND o.created_at < '2025-01-01'
  AND o.status = 'DELIVERED'
ORDER BY o.created_at DESC;
```

### Storage Estimation
- **Hot DB Growth**: ~146 GB per year (from PRD capacity planning)
- **Archive DBs**: Each year-end, current hot DB becomes the archive for that year
- **Long-term Storage**: All archive DBs retained indefinitely for compliance

## Migration Notes
* Existing migrations in `pkg/migrations` will be duplicated per region with the same DDL, wrapped in a loop that creates the partitioned schema.
* New migrations must add the `region_code` column and update primary keys accordingly.

---
*This design mirrors the conventions used in the core service while adding sharding, region‑aware indexes, and the additional tables required for payments and delivery assignments.*
