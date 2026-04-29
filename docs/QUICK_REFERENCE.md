---
name: Developer Quick Reference & Cheat Sheet
description: Quick lookup guide for common tasks, patterns, and commands in the Order Service
type: reference
---

# Order Service - Developer Quick Reference

**Print this document and keep it at your desk!**

---

## 🚀 Quick Start (First Time Setup)

```bash
# 1. Clone and install
git clone <repo-url>
cd Order-Service
npm install

# 2. Start dev environment
docker-compose up -d

# 3. Run migrations
npm run migrate

# 4. Start dev server
npm run dev              # Starts on http://localhost:3000

# 5. Run tests
npm test               # All tests
npm test -- unit       # Unit tests only
npm test -- integration # Integration tests only

# 6. Check code quality
npm run lint           # ESLint
npm run tsc            # TypeScript compiler
npm test -- --coverage # Code coverage report
```

---

## 📁 File Structure Cheat Sheet

```
src/
├── app/
│   ├── orders/
│   │   ├── controller.ts        ← Handle HTTP requests
│   │   ├── dto.ts               ← CreateOrderRequest, OrderResponse
│   │   └── routes.ts            ← Express router
│   ├── payments/
│   ├── delivery/
│   └── middleware/
│       ├── auth.ts              ← JWT validation
│       ├── validation.ts        ← Input validation
│       └── errorHandler.ts      ← Error formatting
│
├── pkg/
│   ├── order/
│   │   ├── entity.ts            ← Order class (state machine)
│   │   ├── types.ts             ← Enums, constants
│   │   ├── service.ts           ← Business logic
│   │   └── repository.ts        ← Interface
│   ├── payment/
│   └── delivery/
│
└── lib/
    ├── db/
    │   └── repository/          ← DB implementation
    ├── http/                    ← HTTP clients, retries
    ├── cache/                   ← Redis wrappers
    └── events/                  ← PostgreSQL LISTEN/NOTIFY

test/
├── unit/                        ← Mocked dependencies
├── integration/                 ← Real DB/Redis
└── fixtures/                    ← Test data, factories
```

---

## 🔑 Naming Conventions (ENFORCE IN CODE REVIEW)

| Element | Pattern | Example |
|---------|---------|---------|
| **DTO Class** | `<Verb><Entity><Request\|Response>` | `CreateOrderRequest`, `OrderResponse` |
| **Entity** | `<Entity>` (matches table name) | `Order`, `Payment` |
| **Service** | `<Entity>Service` | `OrderService` |
| **Repository** | `<Entity>Repository` | `OrderRepository` |
| **Middleware** | `<purpose><middleware>` | `authMiddleware`, `validationMiddleware` |
| **DB Column** | `snake_case` | `order_id`, `region_code` |
| **Redis Key** | `<entity>:<region>:<id>` | `order:US:uuid` |
| **DB Index** | `idx_<table>_<columns>` | `idx_orders_status_created_at` |
| **FK** | `fk_<child>_<parent>` | `fk_orders_src_acc_id_users` |
| **Error Code** | `UPPER_SNAKE_CASE` | `ORDER_NOT_FOUND`, `INVALID_REGION` |

---

## 💾 Database Patterns (Copy-Paste Ready)

### Find Latest Orders for Customer
```sql
SELECT o.*, json_agg(json_build_object(
  'itemId', oi.item_id,
  'productId', oi.product_id,
  'quantity', oi.quantity
)) AS items
FROM orders o
LEFT JOIN order_items oi USING (region_code, order_id)
WHERE o.region_code = $1 
  AND o.src_acc_id = $2
GROUP BY o.order_id
ORDER BY o.created_at DESC
LIMIT $3;
```

### Insert Order with Items (Transaction)
```sql
BEGIN;

INSERT INTO orders 
  (region_code, order_id, src_acc_id, restaurant_id, status, total_amount, currency, created_at, updated_at)
VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, NOW(), NOW())
RETURNING *;

INSERT INTO order_items 
  (region_code, order_id, item_id, product_id, quantity, price, created_at)
VALUES 
  ($1, $2, uuid_generate_v4(), $7, $8, $9, NOW()),
  ($1, $2, uuid_generate_v4(), $10, $11, $12, NOW());

COMMIT;
```

### Update with Optimistic Locking
```sql
UPDATE payments 
SET status = $1, updated_at = NOW(), version = version + 1
WHERE region_code = $2 
  AND payment_id = $3 
  AND version = $4
RETURNING *;

-- If no rows returned, throw OptimisticLockException
```

### Pagination with Cursor
```sql
SELECT *
FROM orders
WHERE region_code = $1 
  AND src_acc_id = $2
  AND (created_at, order_id) < ($3, $4)  -- cursor decoded
ORDER BY created_at DESC, order_id DESC
LIMIT $5 + 1;  -- fetch one extra to determine hasMore
```

### Monitor Index Usage
```sql
SELECT indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'region_us'
ORDER BY idx_scan DESC;
```

---

## 🔗 HTTP Patterns (Copy-Paste Ready)

### Create Order Request
```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "550e8400-e29b-41d4-a716-446655440003",
    "items": [
      {"productId": "550e8400-e29b-41d4-a716-446655440004", "quantity": 2}
    ],
    "currency": "USD",
    "paymentMethod": "KASHIER",
    "regionCode": "US"
  }'
```

### Get Order
```bash
curl http://localhost:3000/api/v1/orders/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Update Order Status
```bash
curl -X PUT http://localhost:3000/api/v1/orders/550e8400-e29b-41d4-a716-446655440000/status \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "CONFIRMED"}'
```

### WebSocket Subscribe (JavaScript)
```javascript
const socket = io('http://localhost:3000', {
  auth: { token: jwtToken }
});

socket.on('connect', () => {
  socket.emit('subscribe', { orderId: 'order-123' });
});

socket.on('ORDER_STATUS_CHANGED', (event) => {
  console.log('Order status:', event.status);
});
```

---

## 🧪 Testing Patterns (Copy-Paste Ready)

### Unit Test Template
```typescript
describe('OrderService', () => {
  let service: OrderService;
  let mockRepository: jest.Mocked<OrderRepository>;
  
  beforeEach(() => {
    mockRepository = createMockRepository();
    service = new OrderService(mockRepository);
  });
  
  it('should do something when condition', async () => {
    mockRepository.findById.mockResolvedValue({ id: 'order-1' });
    
    const result = await service.getById('US', 'order-1');
    
    expect(result.id).toBe('order-1');
    expect(mockRepository.findById).toHaveBeenCalledWith('US', 'order-1');
  });
});
```

### Integration Test Template
```typescript
describe('Orders Integration', () => {
  let db: Pool;
  let app: Express;
  
  beforeAll(async () => {
    db = new Pool({ connectionString: 'postgresql://test' });
    app = createTestApp(db);
  });
  
  afterEach(async () => {
    await db.query('TRUNCATE TABLE orders CASCADE');
  });
  
  it('should create order', async () => {
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    
    expect(response.status).toBe(201);
    
    const db_order = await db.query('SELECT * FROM orders WHERE order_id = $1', [response.body.orderId]);
    expect(db_order.rows).toHaveLength(1);
  });
});
```

---

## 🔐 Security Patterns (Copy-Paste Ready)

### JWT Token Claims
```typescript
interface TokenClaims {
  sub: string;                    // User ID
  accountType: 'CUSTOMER' | 'RESTAURANT' | 'DELIVERY_AGENT' | 'ADMIN';
  regionCode: 'US' | 'EU' | 'APAC' | 'LATAM';
  iat: number;                    // Issued at
  exp: number;                    // Expiration
  iss: string;                    // Issuer (core-service)
}
```

### Verify Kashier Webhook Signature
```typescript
import crypto from 'crypto';

function verifyKashierSignature(payload: string, signature: string, secret: string): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return computed === signature;
}
```

### Rate Limiting (Redis)
```typescript
async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

// Usage
const allowed = await checkRateLimit(`webhook:kashier:${paymentId}`, 1, 60);
if (!allowed) throw new TooManyRequestsException();
```

---

## 📊 Redis Patterns (Copy-Paste Ready)

### Cache-Aside Pattern
```typescript
async function getOrderWithCache(regionCode: string, orderId: string): Promise<Order | null> {
  // Try cache
  const cached = await redis.get(`order:${regionCode}:${orderId}`);
  if (cached) return JSON.parse(cached);
  
  // Cache miss - load from DB
  const order = await orderRepository.findById(regionCode, orderId);
  if (!order) return null;
  
  // Store in cache (TTL 300 seconds)
  await redis.setex(`order:${regionCode}:${orderId}`, 300, JSON.stringify(order));
  return order;
}
```

### Idempotency Key Storage
```typescript
async function handleIdempotency(key: string, handler: () => Promise<any>): Promise<any> {
  // Check if already processed
  const cached = await redis.get(`idempotency:${key}`);
  if (cached) return JSON.parse(cached);
  
  // Process and cache result
  const result = await handler();
  await redis.setex(`idempotency:${key}`, 300, JSON.stringify(result));
  return result;
}
```

### Webhook Lock (Prevent Duplicate Processing)
```typescript
async function acquireWebhookLock(kashierId: string, timeoutSeconds: number): Promise<boolean> {
  const key = `lock:webhook:kashier:${kashierId}`;
  const acquired = await redis.set(key, '1', 'NX', 'EX', timeoutSeconds);
  return acquired === 'OK';
}
```

---

## 🐛 Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `duplicate key value violates unique constraint` | Composite PK violation | Use `INSERT ... ON CONFLICT DO NOTHING` or check uniqueness first |
| `partition pruning not happening` | Query missing `region_code` filter | Always filter by `region_code` FIRST in WHERE clause |
| `N+1 query problem` | Loop with DB query per item | Use `JOIN` or `IN` batch fetch |
| `Timeout waiting for request` | External service slow | Add timeout + retry logic with circuit breaker |
| `Idempotency-Key not working` | Not reading from Redis | Check Redis is running, key not expired |
| `WebSocket events not received` | Not subscribed to channel | Emit subscribe event with order ID |
| `FOREIGN KEY constraint failed` | Referenced row doesn't exist | Validate foreign keys exist before INSERT |

---

## 🔍 Debugging Tips

### View Current Queries
```sql
SELECT pid, usename, state, query, query_start 
FROM pg_stat_activity 
WHERE datname = 'order_service' AND state = 'active';
```

### Explain Query Performance
```sql
EXPLAIN ANALYZE
SELECT * FROM orders 
WHERE region_code = 'US' AND src_acc_id = 'user-1'
ORDER BY created_at DESC
LIMIT 20;

-- Look for: Seq Scan (bad) vs Index Scan (good)
```

### Check Index Usage
```sql
SELECT * FROM pg_stat_user_indexes 
WHERE idx_scan = 0;  -- Unused indexes
```

### Monitor Slow Queries
```sql
-- In postgresql.conf:
log_min_duration_statement = 1000  -- Log queries > 1 second
```

### Debug TypeScript Issues
```bash
# Type check without compile
npm run tsc -- --noEmit

# Show inferred types
npm run tsc -- --listFiles
```

### Verbose Test Output
```bash
npm test -- --verbose
npm test -- --no-coverage  # Faster
npm test -- --bail          # Stop on first failure
```

---

## ⚡ Performance Tips

### 1. Database
- ✅ Always include `region_code` first in WHERE clause
- ✅ Use `JOIN` not separate queries
- ✅ Use `IN (...)` for batch operations
- ✅ Create indexes based on actual query patterns
- ✅ Run ANALYZE periodically: `VACUUM ANALYZE;`

### 2. Caching
- ✅ Cache-aside only (never write-through)
- ✅ Short TTLs (30-60 seconds) for freshness
- ✅ Invalidate on mutations
- ✅ Monitor cache hit rate: should be >70%

### 3. APIs
- ✅ Pagination: cursor-based, not offset
- ✅ Timeout: 2s for core-service, 5s for kashier
- ✅ Retry: 3x exponential backoff
- ✅ Circuit breaker: open after 50% errors in 10 min

### 4. WebSockets
- ✅ Subscribe per order, not per user
- ✅ Heartbeat every 30 seconds
- ✅ Close idle connections after 2 minutes

---

## 📚 Documentation Quick Links

| Task | Document |
|------|----------|
| "How do I start?" | `docs/README.md` |
| "What's the architecture?" | `../claude.md` section 1 |
| "How do I organize code?" | `docs/folder_structure.md` |
| "What's the database schema?" | `docs/database_design.md` |
| "How do I implement Orders?" | `docs/orders_module.md` |
| "How do I integrate Kashier?" | `docs/payments_module.md` |
| "What are the API endpoints?" | `docs/api_contracts.md` |
| "What are the rules?" | `../claude.md` |

---

## 🎯 Checklist Before Submitting PR

- [ ] Code follows naming conventions
- [ ] No N+1 queries (verified with EXPLAIN ANALYZE)
- [ ] All tests pass: `npm test`
- [ ] Code coverage ≥80%
- [ ] No ESLint warnings: `npm run lint`
- [ ] No TypeScript errors: `npm run tsc`
- [ ] Database queries optimized
- [ ] Error codes match `api_contracts.md`
- [ ] DTOs have proper validation
- [ ] Endpoints have `Idempotency-Key` support (if POST/PATCH)
- [ ] WebSocket events emitted (if state changes)
- [ ] Documentation updated (`api_contracts.md`, module docs)
- [ ] Commit messages follow convention
- [ ] No merge conflicts

---

## 🆘 When You're Stuck

1. **Error in tests?** → Check `test/fixtures/` for setup patterns
2. **Database error?** → Check `docs/database_design.md` for schema
3. **API error?** → Check `docs/api_contracts.md` for request/response format
4. **Authorization error?** → Check JWT claims in `../claude.md` section 8
5. **Performance issue?** → Run `EXPLAIN ANALYZE` on query
6. **WebSocket not working?** → Check subscription in browser console
7. **Still stuck?** → Ask tech lead, update this cheat sheet with the solution!

---

**Print this page and keep it at your desk. Update it as you discover new patterns!**
