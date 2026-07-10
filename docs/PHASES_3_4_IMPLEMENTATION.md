# Phases 3 & 4 Implementation Summary

## Overview
Phases 3 and 4 have been completed with full implementation of agent/delivery management and restaurant finance modules. The implementation follows the RBAC-protected endpoint pattern and uses Redis GeoSearch for agent location management.

## Phase 3: Agents & Delivery Assignment

### Architecture Changes
- **Removed**: `deliveries` and `agent_presence` database tables
- **Storage Strategy**: 
  - Agent presence: Redis GeoSearch (`presence:geo:<region>` with 5-minute TTL)
  - Agent status: Redis set (`presence:busy:<region>` for busy agents)
  - Delivery tracking: Order status transitions in `orders` table
  - Agent earnings: `agent_earnings` table (one row per delivered order)

### Key Components

#### 1. Agent Presence Management (`app/agent/`)
- **Endpoint**: `POST /agents/presence/ping` (every 5 minutes)
  - Updates agent location in Redis with 5-minute TTL
  - Streamed location updates sent to customers during delivery
  
- **Endpoint**: `POST /agents/presence/online` / `offline`
  - Sets/clears agent availability status

#### 2. Delivery Lifecycle (`app/agent/delivery-lifecycle.service.ts`)
- **Accepted**: Agent accepts assignment → order stays in `ASSIGNED` status
- **Rejected**: Agent rejects → clears delivery agent, returns to `READY`, triggers reassignment
- **Picked**: Agent marks picked up → order transitions to `PICKED` status
- **Delivered**: Agent completes delivery → triggers financial settlement in same transaction

#### 3. Assignment Module (`app/assignment/`)

**Manual Assignment** (Restaurant Staff):
- Endpoint: `POST /restaurant/:restaurantId/branch/:branchId/deliveries/assign/:orderId`
  - Body: `{ agentId?: number }`
  - If no agentId: auto-select nearest available agent from Redis GeoSearch
  - If agentId provided: assign to that agent (must be online)
  - Requires RBAC permission: `deliveries:assign`

**Reassignment**:
- Endpoint: `POST /restaurant/:restaurantId/branch/:branchId/deliveries/reassign/:orderId`
  - Triggered when agent rejects
  - Max 3 attempts per order (configurable via `MAX_REASSIGNMENT_ATTEMPTS`)
  - Tracks attempts in Redis key: `assignment:reassign:{orderId}`

**Broadcast Job** (`app/assignment/jobs.ts`):
- Background job runs every 60 seconds
- Scans for orders in `READY` status without assignment
- For each ready order:
  1. Finds nearby agents (Redis GeoSearch within `ASSIGNMENT_RADIUS_METERS`)
  2. Broadcasts `order.assignment_offered` event to top 5 agents via WebSocket
  3. Agents have `AGENT_ACCEPT_TIMEOUT_SEC` (default 30s) to accept
  4. First acceptance wins
  5. If no acceptance: release broadcast lock, retry on next cycle

### WebSocket Events (Phase 3)

**Server → Agent**:
- `order.assignment_offered` - New order available (broadcast job)
- `task.assigned` - Order successfully assigned to agent
- `task.cancelled` - Assignment cancelled/expired

**Server → Customer**:
- `delivery.status_changed` - Order delivery status update
- `delivery.position` - Agent location update (real-time)

**Server → Restaurant**:
- `delivery.assigned` - Delivery agent assigned to their order

### Agent Endpoints Summary
```
POST   /agents/presence/online          - Agent comes online
POST   /agents/presence/offline         - Agent goes offline
POST   /agents/presence/ping            - Update location (every 5 min)
GET    /agents/tasks                    - List assigned tasks (agent-only)
GET    /agents/earnings                 - Earnings history (agent-only)
PATCH  /orders/:orderId/delivery/status - Update delivery status
POST   /orders/:orderId/delivery/position - Update position
```

---

## Phase 4: Restaurant Finance

### Architecture
- **Balance Model**: One row per (restaurant, currency) in `restaurant_balances`
- **Transaction Ledger**: `transactions` table with `transaction_type` field (charge, refund, commission, payout, cod_collection, adjustment)
- **No Payout Table**: Payouts are tracked as `transaction_type='payout'` rows

### Financial Settlement on Delivery

When an order is delivered:
1. Lock restaurant balance (SELECT FOR UPDATE)
2. Calculate: `netToRestaurant = order.subtotal - order.commission`
3. Increment `restaurant_balances.balance`
4. Insert commission transaction row (`transaction_type='commission'`)
5. If COD: Mark COD collection transaction as succeeded
6. Insert agent earnings row

### Restaurant Finance Endpoints
```
GET    /restaurant/:restaurantId/finance/balance          - Current balance (owner/manager)
GET    /restaurant/:restaurantId/finance/payouts          - Payout history (owner/manager)
POST   /restaurant/:restaurantId/finance/payouts          - Record payout (admin-only)
```

**Query Parameters**:
- `from` - Start date (ISO 8601)
- `to` - End date (ISO 8601)
- `limit` - Page size (default 50)
- `cursor` - Pagination cursor

### RBAC Permissions
- `finance:read` → owner, manager, staff (read-only access to balance/payouts)
- `finance:payout_create` → system_admin (create payout transactions)

---

## Order Service Route Pattern

All protected order/delivery/finance endpoints follow the RBAC pattern:

```
/restaurant/:restaurantId/branch/:branchId/orders                    - List orders
/restaurant/:restaurantId/branch/:branchId/orders/:orderId/status    - Update status
/restaurant/:restaurantId/branch/:branchId/deliveries/assign/:orderId - Assign delivery
/restaurant/:restaurantId/finance/balance                            - Get balance
/restaurant/:restaurantId/finance/payouts                            - List payouts
```

This allows the RBAC middleware to:
1. Validate JWT
2. Check if user has permission for the resource
3. Verify restaurantId/branchId ownership (application layer)

---

## Configuration

### Environment Variables (Phase 3 & 4)
```
ASSIGNMENT_RADIUS_METERS=5000          # Geo search radius (meters)
AGENT_ACCEPT_TIMEOUT_SEC=30            # Seconds to accept offer
MAX_REASSIGNMENT_ATTEMPTS=3            # Max reassignment retries
PRESENCE_STALE_SEC=90                  # Agent presence stale timeout
AGENT_EARNING_SHARE_BPS=7000           # Agent earning as % of delivery fee (in basis points)
```

---

## Database Schema (Phase 3 & 4)

### No Changes from Phases 0-2
- `orders` - Already has `delivery_agent_id`, delivery status fields, timestamps
- `order_items` - No changes
- `payment_sessions`, `transactions`, `payment_webhook_events` - No changes

### New Tables (Already Migrated)
- `restaurant_balances` - One row per (restaurant, currency)
- `agent_earnings` - One row per delivered order

### Redis Keys (No DB Table)
```
presence:geo:{region}                 # GeoSearch set of agents and their locations
presence:busy:{region}                # Set of currently busy agents
presence:agent:{agentId}              # Agent metadata (name, phone) with 5-min TTL
agent:location:{agentId}              # Agent's current lat/lng with 5-min TTL
assignment:offer:{orderId}:{agentId}  # Track offers sent to agents
assignment:accepted:{orderId}         # Track first acceptance
assignment:reassign:{orderId}         # Reassignment attempt counter
```

---

## Background Jobs

### Assignment Ready Orders Job
- **Schedule**: Every 60 seconds
- **Function**: Scan for READY orders without delivery agent and broadcast
- **Registration**: `registerAssignmentJobs()` called in `src/worker.ts`
- **Implementation**: `src/app/assignment/jobs.ts`

### Job Scheduler Architecture
- Simple registry pattern with `start()` / `stop()` hooks
- Jobs can use `setInterval`, background loops, or external cron
- All jobs managed by `startAll()` / `stopAll()` at worker boot/shutdown

---

## Testing Checklist

### Phase 3 Tests
- [ ] Agent presence ping updates Redis GeoSearch location
- [ ] Agent can accept assignment within timeout
- [ ] First acceptance wins; others are rejected
- [ ] Manual assignment works (restaurant staff assigns agent)
- [ ] Reassignment after rejection works
- [ ] WebSocket events broadcast correctly:
  - `order.assignment_offered` to agents
  - `task.assigned` to agent
  - `delivery.status_changed` to customer/restaurant
  - `delivery.position` to customer (real-time)
- [ ] Order transitions: READY → ASSIGNED → PICKED → DELIVERED
- [ ] Agent earnings row inserted on delivery

### Phase 4 Tests
- [ ] Restaurant balance incremented on delivery
- [ ] Commission transaction recorded
- [ ] COD collection marked succeeded on delivery
- [ ] Restaurant can view balance with permission check
- [ ] Restaurant can view payouts (paginated)
- [ ] Admin can record payout (updates balance, creates transaction)
- [ ] Payout idempotency works (same idempotency key = same result)

---

## Known Limitations & Future Work

1. **Auto-Assignment**: Currently broadcasts to nearby agents, first acceptance wins. Could be enhanced with:
   - Rating-based selection
   - Historical acceptance rate
   - Vehicle type matching
   
2. **Presence Cleanup**: Agents marked as "stale" after 90s without ping. Manual cleanup job could be added.

3. **Delivery Tracking**: Currently agent location updates are ephemeral. Could add:
   - Delivery history in separate table
   - Route optimization
   - Delivery time predictions

4. **Commission Calculation**: Currently fixed per branch. Could enhance with:
   - Dynamic commission based on order value
   - Peak-hour bonuses
   - Segment-based rates

---

## Migration Checklist

- [x] `20260418000060_create_restaurant_balances.ts`
- [x] `20260418000090_create_agent_earnings.ts`
- [x] Database indexes for queries
- [x] Order repository updated
- [x] Assignment service implemented
- [x] Finance service implemented
- [x] RBAC endpoints with proper permission checks
- [x] WebSocket event broadcasting
- [x] Background job registration
- [x] Route mounting in main routes file

---

## Dependencies Added

No new external dependencies for phases 3 & 4. All features use:
- Socket.io (already installed)
- Redis (already installed)
- Knex (already installed)
- tsyringe DI (already installed)

---

## Files Modified/Created

### New Files
- `src/lib/jobs/scheduler.ts` - Job registry and lifecycle management
- `src/lib/events/jobs.ts` - Outbox drain job placeholder
- `src/app/assignment/jobs.ts` - Assignment broadcast job
- `src/app/order/core-events.handlers.ts` - Core event handler registration

### Modified Files
- `src/app/order/routes.ts` - Added RBAC pattern endpoints
- `src/app/order/controller/order.controller.ts` - Updated to use route params
- `src/app/agent/routes.ts` - Updated endpoint patterns
- `src/app/assignment/routes.ts` - Added RBAC pattern with restaurant/branch
- `src/app/finance/routes.ts` - Added RBAC pattern with restaurant
- `src/app/finance/controller/finance.controller.ts` - Updated to use route params
- `src/app/order/repository/order.repo.ts` - Added `findOrdersByStatus()` method
- `docs/database-design.md` - Removed `agent_presence` and `deliveries` from sharded tables
- `docs/implementation-plan.md` - Updated Phase 3 description

---

## Deployment Notes

1. Ensure Redis is configured with GeoSearch capability (Redis 6.2+)
2. Run migrations on all configured regions
3. Set environment variables for assignment parameters
4. Worker process should be running for background jobs
5. Socket.io server must be accessible for WebSocket connections
6. RBAC permissions must be seeded in core-service

---

## Summary

Phases 3 and 4 are now complete with:
- ✅ Manual delivery assignment with WebSocket-based accept/reject
- ✅ Automatic broadcast to nearby agents (background job)
- ✅ Agent presence tracking via Redis GeoSearch
- ✅ Delivery lifecycle management (accepted → picked → delivered)
- ✅ Financial settlement on delivery (balance + commission + earnings)
- ✅ RBAC-protected endpoints following restaurant/branch pattern
- ✅ Real-time WebSocket events for agents, customers, and restaurants
- ✅ Cursor pagination support on order and payout queries
- ✅ TypeScript compilation successful

All code follows the established patterns from core-service and maintains consistency across the platform.

