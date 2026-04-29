---
name: Folder Structure
description: Recommended directory layout and naming conventions for the Order Service, aligned with the Core Service
type: reference
---

# Folder Structure

The Order Service mirrors the **core‑service** layout to keep onboarding consistent and to allow shared tooling (code‑generation, linter, CI). All Go/Kotlin/Java sources live under `src/` (or `app/` for Java/Kotlin). The tree below is the canonical view:

```
order-service/
├─ cmd/                     # Executable entry‑points (main packages)
│   └─ order-service/       # `main.go` – bootstraps the application
├─ configs/                # YAML/TOML configuration files (application.yml, logback.xml)
│   └─ application.yml
├─ docs/                   # All documentation (this folder)
├─ internal/               # Private packages – not exported to other services
│   ├─ app/                # Layered architecture (controllers → services → repos)
│   │   ├─ orders/
│   │   │   ├─ controller/
│   │   │   │   └─ OrderController.java
│   │   │   ├─ dto/        # Request/Response DTOs
│   │   │   │   ├─ CreateOrderRequest.java
│   │   │   │   └─ CreateOrderResponse.java
│   │   │   ├─ entity/    # Domain entities that map 1:1 to DB tables
│   │   │   │   └─ Order.java
│   │   │   ├─ repository/ # Repository interfaces + concrete sqlx/Jdbc impl
│   │   │   │   └─ OrderRepository.java
│   │   │   └─ service/    # Business logic, transaction handling
│   │   │       └─ OrderService.java
│   │   ├─ payments/ … (same pattern)
│   │   └─ delivery/ … (same pattern)
│   └─ websocket/         # Global websocket broadcaster & connection manager
├─ lib/                    # Re‑usable utilities that **do not** depend on `internal/app`
│   ├─ db/                 # DB connection factories, sharding helpers
│   │   └─ ShardManager.java
│   ├─ http/               # RestTemplate / OkHttp wrappers, retry policies
│   ├─ cache/              # Redis client wrappers (key prefixes, serialization)
│   └─ events/             # PostgreSQL LISTEN/NOTIFY bridge
├─ pkg/                    # Public libraries that may be imported by other services
│   └─ api/                # OpenAPI generated client for core‑service
├─ test/                   # Integration and contract tests (JUnit/TestNG)
│   └─ orders/ …
└─ build/ (or gradle/ mvn) # Build scripts, Dockerfile, CI configs
```

## Naming Conventions
| Element | Convention |
|---------|-------------|
| **Package folder** | lower‑case, singular (`orders`, `payments`) |
| **DTO class** | `PascalCase` with suffix `Request` / `Response` (e.g., `CreateOrderRequest`) |
| **Entity class** | `PascalCase` matching table name (`Order`, `Payment`) |
| **Repository interface** | `<Entity>Repository` (e.g., `OrderRepository`) |
| **Service class** | `<Entity>Service` (e.g., `OrderService`) |
| **Controller** | `<Entity>Controller` – annotated with `@RestController` and mapped under `/api/v1/<entity>` |
| **SQL columns** | `snake_case` – primary key: `region_code`, `<entity>_id` (composite with `region_code`) |
| **Indexes** | `idx_<entity>_<column1>_<column2>` (e.g., `idx_orders_status_created_at`) |
| **Foreign keys** | `fk_<child>_<parent>` (e.g., `fk_orders_src_acc_id_users`) |
| **Redis keys** | `<entity>:<region>:<id>` (e.g., `order:US:3fa85f64-5717-4562-b3fc-2c963f66afa6`) |

## Layer Isolation Rules
* **`lib/`** must **not** import anything from `internal/` – it is deliberately dependency‑free so other services can reuse the utilities.
* **`internal/app/`** may import `lib/` and `pkg/` but never the opposite.
* **`pkg/`** is public; keep its API stable because other micro‑services may depend on it.
* Tests in `test/` can import any internal package using the `..` relative path for unit tests, but integration tests should spin up the whole application via the `cmd/` entry point.

## Sharding‑aware Code
* All repository methods accept `regionCode` as the first argument and forward it to `ShardManager.getDataSource(regionCode)`.
* The `ShardManager` lives in `lib/db/` and caches a `DataSource` per region; it is initialized at application start from the `configs/sharding.yml` file.
* Queries **must** include `region_code = $1` as the leading WHERE clause to enable PostgreSQL partition pruning.

---
*Following this structure guarantees that new developers can instantly locate the entry point for a domain, that shared utilities stay reusable, and that sharding constraints are enforced by compile‑time patterns.*
