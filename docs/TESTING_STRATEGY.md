---
name: Testing Strategy & Quality Assurance
description: Comprehensive testing approach for the Order Service, including unit, integration, E2E, and performance testing guidelines
type: reference
---

# Order Service - Testing Strategy & Quality Assurance

## Overview

This document defines the testing strategy for the QuickBite Order Service, aligned with the implementation roadmap. Quality is a non-negotiable constraint: all features must achieve >80% code coverage with comprehensive unit and integration tests before merging to main.

---

## Testing Pyramid & Coverage Targets

```
                    ▲
                   ╱ ╲
                  ╱   ╲  E2E & Manual Testing (10%)
                 ╱     ╲  • Happy path scenarios
                ╱───────╲ • Cross-module workflows
               ╱         ╲
              ╱           ╲
             ╱─────────────╲ Integration Tests (25%)
            ╱               ╲ • Real DB, Redis, HTTP mocks
           ╱                 ╲ • Module interactions
          ╱───────────────────╲
         ╱                     ╲ Unit Tests (65%)
        ╱_____________________╲ • Isolated, mocked dependencies
       ╱                       ╲ • Fast execution
      ╱─────────────────────────╲
     Base
```

**Coverage Targets**:
- **Unit Tests**: >85% (statements, branches, lines)
- **Integration Tests**: >70% (core workflows)
- **E2E Tests**: Happy path + critical failure scenarios
- **Overall**: Minimum 80% across all tests combined

---

## Phase 1: Database Testing (Week 1)

### Database Schema Validation

**Objective**: Ensure schema, indexes, and partitioning work correctly

**Test Type**: Integration tests against real PostgreSQL

**Test Cases**:

#### 1.1 Schema Creation
- [ ] All tables created with correct columns
- [ ] Column types match specification (UUID, JSONB, numeric, etc.)
- [ ] Primary keys are composite: (region_code, entity_id)
- [ ] NOT NULL constraints enforced
- [ ] DEFAULT values work (e.g., created_at = NOW())
- [ ] CHECK constraints work (e.g., total_amount > 0)

#### 1.2 Partitioning
- [ ] Parent table created
- [ ] Child partitions created per region (US, EU, APAC, LATAM)
- [ ] Partition pruning works (EXPLAIN ANALYZE shows correct partition)
- [ ] INSERT routes to correct partition based on region_code
- [ ] INSERT to non-existent region fails gracefully

#### 1.3 Indexes
- [ ] All query-driven indexes created
- [ ] Composite indexes in correct column order
- [ ] UNIQUE constraints on kashier_payment_id work
- [ ] Index selectivity is good (use EXPLAIN ANALYZE)
- [ ] No unused indexes (run pg_stat_user_indexes query)

#### 1.4 Foreign Keys
- [ ] FK constraints enforced
- [ ] ON DELETE CASCADE works for child tables
- [ ] ON DELETE RESTRICT prevents deletes when children exist
- [ ] ON DELETE SET NULL allows NULL for nullable FKs
- [ ] Cross-database FKs fail gracefully (app validates)

#### 1.5 Migration System
- [ ] Migrate forward: `npm run migrate` completes
- [ ] Schema matches specification exactly
- [ ] Rollback works: `npm run migrate:rollback`
- [ ] Idempotent: running twice produces same result
- [ ] New region migration works: `npm run migrate -- --region=NEWREGION`

### Tools
- **Framework**: Jest with PostgreSQL test container
- **Database**: PostgreSQL 15 in Docker
- **Assertions**: pg library for direct SQL execution
- **Utilities**: Database factory for cleanup between tests

### Example Test

```typescript
describe('Database Schema', () => {
  let db: Pool;
  
  beforeAll(async () => {
    db = new Pool({ connectionString: 'postgresql://...' });
  });
  
  afterEach(async () => {
    await db.query('TRUNCATE TABLE orders CASCADE');
  });
  
  it('should create order with region sharding', async () => {
    const result = await db.query(`
      INSERT INTO orders 
        (region_code, order_id, src_acc_id, dst_acc_id, restaurant_id, 
         status, total_amount, currency, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `, ['US', 'uuid-1', 'user-1', 'rest-1', 'prod-1', 'PENDING', 23.50, 'USD']);
    
    expect(result.rows[0].region_code).toBe('US');
    expect(result.rows[0].status).toBe('PENDING');
  });
  
  it('should enforce composite primary key uniqueness', async () => {
    await db.query(`INSERT INTO orders (...) VALUES ('US', 'uuid-1', ...)`);
    
    const duplicate = db.query(`INSERT INTO orders (...) VALUES ('US', 'uuid-1', ...)`);
    
    await expect(duplicate).rejects.toThrow('duplicate key');
  });
});
```

---

## Phase 2: Orders Module Testing (Week 2-3)

### Unit Tests

**Objective**: Test business logic in isolation with mocked dependencies

**Test Coverage**: >85% (statements, branches)

#### Order Entity Unit Tests

```typescript
describe('Order Entity', () => {
  it('should create order in PENDING state', () => {
    const order = Order.create({
      id: 'uuid',
      restaurantId: 'rest-1',
      items: [{ productId: 'prod-1', quantity: 2, price: 10.50 }],
      totalAmount: 21.00
    });
    
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.items).toHaveLength(1);
  });
  
  it('should validate state transitions', () => {
    const order = Order.create({ ... });
    
    order.confirm();
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    
    order.markPreparing();
    expect(order.status).toBe(OrderStatus.PREPARING);
    
    expect(() => order.confirm()).toThrow('Invalid transition');
  });
  
  it('should prevent DELIVERED → * transitions', () => {
    const order = Order.create({ ... });
    order.status = OrderStatus.DELIVERED;
    
    expect(() => order.markCancelled()).toThrow('Cannot transition from DELIVERED');
  });
});
```

#### Order Service Unit Tests

```typescript
describe('OrderService', () => {
  let service: OrderService;
  let mockRepository: jest.Mocked<OrderRepository>;
  let mockCoreService: jest.Mocked<CoreServiceClient>;
  let mockCache: jest.Mocked<RedisCache>;
  
  beforeEach(() => {
    mockRepository = createMockRepository();
    mockCoreService = createMockCoreService();
    mockCache = createMockCache();
    
    service = new OrderService(mockRepository, mockCoreService, mockCache);
  });
  
  it('should create order with transaction', async () => {
    const dto: CreateOrderRequest = {
      restaurantId: 'rest-1',
      items: [{ productId: 'prod-1', quantity: 2 }],
      regionCode: 'US'
    };
    
    mockCoreService.validateRestaurant.mockResolvedValue(true);
    mockRepository.insert.mockResolvedValue({ id: 'order-1', status: 'PENDING' });
    
    const result = await service.createOrder(dto, 'US');
    
    expect(result.orderId).toBe('order-1');
    expect(mockRepository.insert).toHaveBeenCalled();
    expect(mockCache.set).toHaveBeenCalled();
  });
  
  it('should throw if restaurant not found', async () => {
    mockCoreService.validateRestaurant.mockResolvedValue(false);
    
    const promise = service.createOrder({
      restaurantId: 'invalid',
      items: [],
      regionCode: 'US'
    }, 'US');
    
    await expect(promise).rejects.toThrow('Restaurant not found');
  });
  
  it('should cache order on retrieval', async () => {
    mockCache.get.mockResolvedValue(null); // Cache miss
    mockRepository.findById.mockResolvedValue({ id: 'order-1' });
    
    await service.getById('US', 'order-1');
    
    expect(mockCache.get).toHaveBeenCalledWith('order:US:order-1');
    expect(mockCache.set).toHaveBeenCalledWith('order:US:order-1', expect.any(Object), 300);
  });
});
```

### Integration Tests

**Objective**: Test module workflows with real database but mocked external services

**Test Coverage**: >70% (core workflows)

#### Orders Integration Tests

```typescript
describe('Orders Integration', () => {
  let app: Express;
  let db: Pool;
  let redis: Redis;
  
  beforeAll(async () => {
    db = new Pool({ connectionString: 'postgresql://test' });
    redis = new Redis({ host: 'localhost', port: 6380 });
    app = createTestApp(db, redis);
  });
  
  afterEach(async () => {
    await db.query('TRUNCATE TABLE orders CASCADE');
    await redis.flushdb();
  });
  
  it('should create order with all items', async () => {
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + validToken)
      .set('Idempotency-Key', 'key-1')
      .send({
        restaurantId: 'rest-1',
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 }
        ],
        currency: 'USD',
        regionCode: 'US',
        paymentMethod: 'KASHIER'
      });
    
    expect(response.status).toBe(201);
    expect(response.body.orderId).toBeDefined();
    expect(response.body.status).toBe('PENDING');
    expect(response.body.items).toHaveLength(2);
    
    // Verify in DB
    const dbResult = await db.query(
      'SELECT * FROM orders WHERE order_id = $1', 
      [response.body.orderId]
    );
    expect(dbResult.rows).toHaveLength(1);
  });
  
  it('should support idempotency', async () => {
    const payload = { restaurantId: 'rest-1', items: [...], ... };
    const key = 'key-1';
    
    const response1 = await request(app)
      .post('/api/v1/orders')
      .set('Idempotency-Key', key)
      .send(payload);
    
    const response2 = await request(app)
      .post('/api/v1/orders')
      .set('Idempotency-Key', key)
      .send(payload);
    
    expect(response2.body.orderId).toBe(response1.body.orderId);
    expect(response2.status).toBe(201);
  });
  
  it('should validate restaurant exists', async () => {
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + validToken)
      .send({
        restaurantId: 'invalid-rest',
        items: [],
        regionCode: 'US'
      });
    
    expect(response.status).toBe(404);
    expect(response.body.errorCode).toBe('RESTAURANT_NOT_FOUND');
  });
});
```

### DoD Checklist for Phase 2

- [ ] All entity unit tests pass (`npm test -- unit/orders/entity`)
- [ ] All service unit tests pass (`npm test -- unit/orders/service`)
- [ ] All controller unit tests pass (`npm test -- unit/orders/controller`)
- [ ] All integration tests pass (`npm test -- integration/orders`)
- [ ] Code coverage: >85% (statements, branches, lines)
- [ ] ESLint clean: no warnings or errors
- [ ] All error codes documented in `api_contracts.md`
- [ ] Database queries verified with EXPLAIN ANALYZE (no slow queries)
- [ ] Manual testing: Create, read, update, delete orders via API

---

## Phase 3: Payments Module Testing (Week 3-4)

### Unit Tests

**Objective**: Test Kashier integration with mocked HTTP calls

#### Payment Service Unit Tests

```typescript
describe('PaymentService', () => {
  let service: PaymentService;
  let mockRepository: jest.Mocked<PaymentRepository>;
  let mockKashier: jest.Mocked<KashierClient>;
  let mockOrderService: jest.Mocked<OrderService>;
  
  beforeEach(() => {
    mockRepository = createMockRepository();
    mockKashier = createMockKashier();
    mockOrderService = createMockOrderService();
    
    service = new PaymentService(mockRepository, mockKashier, mockOrderService);
  });
  
  it('should create payment session with Kashier', async () => {
    const dto: CreatePaymentRequest = {
      orderId: 'order-1',
      paymentMethod: 'KASHIER',
      regionCode: 'US',
      returnUrl: 'https://...'
    };
    
    mockKashier.createSession.mockResolvedValue({
      sessionId: 'session-1',
      sessionUrl: 'https://pay.kashier.io/...'
    });
    mockRepository.insert.mockResolvedValue({ id: 'payment-1' });
    
    const result = await service.initiatePayment(dto);
    
    expect(result.kashierSessionUrl).toBe('https://pay.kashier.io/...');
    expect(mockRepository.insert).toHaveBeenCalled();
  });
  
  it('should handle webhook with signature verification', async () => {
    const payload = { paymentId: 'payment-1', status: 'SUCCESS' };
    const signature = generateSignature(payload, secret);
    
    mockRepository.updateStatus.mockResolvedValue(undefined);
    mockOrderService.updateStatus.mockResolvedValue(undefined);
    
    await service.handleWebhook(payload, signature);
    
    expect(mockRepository.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS' })
    );
    expect(mockOrderService.updateStatus).toHaveBeenCalled();
  });
  
  it('should reject webhook with invalid signature', async () => {
    const payload = { paymentId: 'payment-1', status: 'SUCCESS' };
    const invalidSignature = 'invalid';
    
    const promise = service.handleWebhook(payload, invalidSignature);
    
    await expect(promise).rejects.toThrow('Signature verification failed');
  });
  
  it('should be idempotent on webhook duplication', async () => {
    const payload = { kashierPaymentId: 'kp-1', status: 'SUCCESS' };
    
    mockRepository.updateStatus.mockImplementation(({ version }) => {
      if (version !== 1) throw new OptimisticLockException('Version mismatch');
      return Promise.resolve();
    });
    
    // First call succeeds
    await service.handleWebhook(payload, validSignature);
    
    // Second call (duplicate) should not update (optimistic lock prevents it)
    const promise = service.handleWebhook(payload, validSignature);
    
    // Should handle gracefully (return 200)
    await expect(promise).resolves.not.toThrow();
  });
});
```

### Integration Tests

**Objective**: Test Kashier webhook flow with real database

#### Payments Integration Tests

```typescript
describe('Payments Integration', () => {
  it('should process payment webhook and confirm order', async () => {
    // Setup: Create order first
    const order = await createTestOrder(db, { status: 'PENDING' });
    
    // Create payment
    const paymentResponse = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({
        orderId: order.id,
        paymentMethod: 'KASHIER',
        regionCode: 'US'
      });
    
    expect(paymentResponse.status).toBe(201);
    const paymentId = paymentResponse.body.paymentId;
    
    // Simulate Kashier webhook callback
    const webhookPayload = {
      paymentId: paymentId,
      kashierPaymentId: 'kp-12345',
      status: 'SUCCESS',
      amount: order.totalAmount,
      currency: 'USD',
      processedAt: new Date().toISOString()
    };
    
    const signature = generateKashierSignature(webhookPayload, kashierSecret);
    
    const webhookResponse = await request(app)
      .post('/api/v1/payments/kashier-webhook')
      .set('X-Kashier-Signature', signature)
      .send(webhookPayload);
    
    expect(webhookResponse.status).toBe(200);
    
    // Verify payment status updated
    const paymentDB = await db.query(
      'SELECT * FROM payments WHERE payment_id = $1',
      [paymentId]
    );
    expect(paymentDB.rows[0].status).toBe('SUCCESS');
    
    // Verify order status updated to CONFIRMED
    const orderDB = await db.query(
      'SELECT * FROM orders WHERE order_id = $1',
      [order.id]
    );
    expect(orderDB.rows[0].status).toBe('CONFIRMED');
  });
  
  it('should reject webhook with invalid signature', async () => {
    const payload = { paymentId: 'p-1', status: 'SUCCESS' };
    
    const response = await request(app)
      .post('/api/v1/payments/kashier-webhook')
      .set('X-Kashier-Signature', 'invalid-signature')
      .send(payload);
    
    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe('SIGNATURE_VERIFICATION_FAILED');
  });
});
```

### DoD Checklist for Phase 3

- [ ] All payment unit tests pass
- [ ] All integration tests pass
- [ ] Code coverage: >85%
- [ ] Kashier signature verification working
- [ ] Idempotency tested (same webhook called twice)
- [ ] Optimistic locking tested
- [ ] Error codes match `api_contracts.md`
- [ ] Manual testing: Create payment → Receive webhook → Verify order confirmed

---

## Phase 4: Delivery Module Testing (Week 4)

### Unit & Integration Tests

**Objective**: Test delivery agent assignment and status tracking

#### Delivery Service Tests

```typescript
describe('DeliveryService', () => {
  it('should assign agent with validation', async () => {
    const order = await createTestOrder(db, { status: 'CONFIRMED' });
    
    const assignResponse = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        orderId: order.id,
        deliveryAgentId: 'agent-1',
        regionCode: 'US'
      });
    
    expect(assignResponse.status).toBe(201);
    expect(assignResponse.body.status).toBe('ASSIGNED');
  });
  
  it('should enforce state transitions', async () => {
    const assignment = await createTestAssignment(db);
    
    // Valid: ASSIGNED → IN_TRANSIT
    const updateResponse = await request(app)
      .put(`/api/v1/delivery/${assignment.id}/status`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ status: 'IN_TRANSIT' });
    
    expect(updateResponse.status).toBe(200);
    
    // Invalid: IN_TRANSIT → ASSIGNED (backward)
    const invalidResponse = await request(app)
      .put(`/api/v1/delivery/${assignment.id}/status`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ status: 'ASSIGNED' });
    
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.body.errorCode).toBe('INVALID_TRANSITION');
  });
});
```

---

## Phase 5: WebSocket Testing (Week 5)

### Integration Tests

**Objective**: Test real-time event broadcasting

#### WebSocket Tests

```typescript
describe('WebSocket Events', () => {
  it('should broadcast order status changes', async (done) => {
    const order = await createTestOrder(db);
    
    // Connect WebSocket client
    const socket = io(`http://localhost:${port}`, {
      auth: { token: validToken }
    });
    
    socket.on('connect', () => {
      socket.emit('subscribe', { orderId: order.id });
    });
    
    socket.on('ORDER_STATUS_CHANGED', (event) => {
      expect(event.orderId).toBe(order.id);
      expect(event.status).toBe('CONFIRMED');
      socket.disconnect();
      done();
    });
    
    // Trigger status change
    await request(app)
      .put(`/api/v1/orders/${order.id}/status`)
      .set('Authorization', 'Bearer ' + restaurantToken)
      .send({ status: 'CONFIRMED' });
  });
});
```

---

## End-to-End (E2E) Testing

### Happy Path Scenarios

```typescript
describe('E2E: Order Lifecycle', () => {
  it('should complete full order workflow', async () => {
    // 1. Customer creates order
    const orderResponse = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', 'Bearer ' + customerToken)
      .send(createOrderPayload);
    
    const orderId = orderResponse.body.orderId;
    expect(orderResponse.status).toBe(201);
    
    // 2. Initiate payment
    const paymentResponse = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', 'Bearer ' + customerToken)
      .send({ orderId, paymentMethod: 'KASHIER' });
    
    expect(paymentResponse.status).toBe(201);
    
    // 3. Simulate webhook (payment success)
    await simulateKashierWebhook(orderId, 'SUCCESS');
    
    // 4. Verify order is CONFIRMED
    const orderCheck = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', 'Bearer ' + customerToken);
    
    expect(orderCheck.body.status).toBe('CONFIRMED');
    
    // 5. Assign delivery agent
    const assignResponse = await request(app)
      .post('/api/v1/delivery/assign')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ orderId, deliveryAgentId: 'agent-1' });
    
    expect(assignResponse.status).toBe(201);
    
    // 6. Agent marks as in transit
    const transitResponse = await request(app)
      .put(`/api/v1/delivery/${assignResponse.body.assignmentId}/status`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ status: 'IN_TRANSIT' });
    
    expect(transitResponse.status).toBe(200);
    
    // 7. Agent marks as delivered
    const deliveredResponse = await request(app)
      .put(`/api/v1/delivery/${assignResponse.body.assignmentId}/status`)
      .set('Authorization', 'Bearer ' + agentToken)
      .send({ status: 'DELIVERED' });
    
    expect(deliveredResponse.status).toBe(200);
    
    // 8. Verify final order status is DELIVERED
    const finalCheck = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', 'Bearer ' + customerToken);
    
    expect(finalCheck.body.status).toBe('DELIVERED');
  });
});
```

---

## Performance & Load Testing

### Load Testing Strategy

**Tool**: k6 or Artillery  
**Goal**: Verify throughput under normal and peak load

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 100,          // Virtual users
  duration: '5m',    // 5 minutes test
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95th percentile < 500ms
    http_req_failed: ['rate<0.1'],     // <10% errors
  }
};

export default function () {
  const payload = JSON.stringify({
    restaurantId: 'rest-1',
    items: [{ productId: 'prod-1', quantity: 1 }],
    regionCode: 'US'
  });
  
  const response = http.post(
    'http://localhost:3000/api/v1/orders',
    payload,
    { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token } }
  );
  
  check(response, {
    'status is 201': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

### Performance Targets

| Metric | Target | Measured |
|--------|--------|----------|
| Order Creation (p50) | <100ms | - |
| Order Creation (p95) | <500ms | - |
| Order Retrieval | <50ms | - |
| Payment Processing | <2s | - |
| Delivery Assignment | <500ms | - |
| WebSocket Event Latency | <100ms | - |
| Error Rate | <0.1% | - |
| Peak Throughput | 1000 req/s | - |

---

## Testing Tools & Configuration

### Dependencies
```json
{
  "devDependencies": {
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@shelf/jest-postgresql": "^4.0.0",
    "supertest": "^6.0.0",
    "socket.io-client": "^4.0.0",
    "redis": "^4.0.0",
    "@types/jest": "^29.0.0"
  }
}
```

### Jest Configuration
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts'
  ],
  coverageThreshold: {
    global: { statements: 80, branches: 80, lines: 80, functions: 80 }
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
```

### Running Tests
```bash
# All tests
npm test

# Unit tests only
npm test -- test/unit

# Integration tests only
npm test -- test/integration

# With coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# Specific module
npm test -- test/unit/orders
```

---

## Quality Gates (Definition of Done)

Before any code merges to `main`:

### Code Quality
- [ ] All tests pass: `npm test`
- [ ] Code coverage ≥80%: `npm test -- --coverage`
- [ ] ESLint clean: `npm run lint` (no errors or warnings)
- [ ] TypeScript strict mode: `npm run tsc` (no type errors)
- [ ] No security vulnerabilities: `npm audit`

### Functional Testing
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E happy paths tested
- [ ] Error scenarios tested
- [ ] Edge cases tested

### Performance Testing
- [ ] Database queries optimized (EXPLAIN ANALYZE)
- [ ] No N+1 queries
- [ ] Cache hit rates >70%
- [ ] P95 latency < 500ms
- [ ] Error rate <0.1%

### Documentation
- [ ] Code comments added for complex logic
- [ ] JSDoc comments on public methods
- [ ] README updated if new features
- [ ] API contracts updated in `api_contracts.md`
- [ ] Database schema updated if changed

### Code Review
- [ ] At least 2 approvals (one from tech lead)
- [ ] All feedback addressed
- [ ] No merge conflicts
- [ ] CI pipeline passes

---

## Continuous Integration (CI) Pipeline

### GitHub Actions Workflow

```yaml
name: Test & Quality

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install Dependencies
        run: npm ci
      
      - name: Run Linter
        run: npm run lint
      
      - name: Run Type Check
        run: npm run tsc
      
      - name: Run Tests
        run: npm test -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/test
          REDIS_URL: redis://localhost:6379
      
      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
      
      - name: Check Coverage
        run: npm test -- --coverage --coverageReporters=text-summary
        # Fails if coverage < 80%
```

---

## Testing Best Practices

### 1. Mocking Strategies
- **Mocking**: External APIs (Kashier, Core Service), Redis, database queries
- **Test Doubles**: Use `jest.mock()` or manual test doubles
- **Avoid**: Mocking internal service calls (test integration instead)

### 2. Test Organization
```
test/
├── unit/
│   ├── orders/
│   │   ├── entity.spec.ts
│   │   ├── service.spec.ts
│   │   └── repository.spec.ts
│   ├── payments/
│   └── delivery/
├── integration/
│   ├── orders.e2e.ts
│   ├── payments.e2e.ts
│   └── delivery.e2e.ts
└── fixtures/
    ├── database.ts
    ├── factories.ts
    └── mocks.ts
```

### 3. Naming Conventions
- Test files: `{module}.spec.ts`
- Test suites: `describe('ClassName', () => { ... })`
- Test cases: `it('should do X when Y happens', () => { ... })`

### 4. Assertions
- Use `expect()` style (Jest default)
- Be specific: `expect(status).toBe('PENDING')` not `expect(order).toBeDefined()`
- Test behavior, not implementation

### 5. Async Testing
- Use `async/await` for promise handling
- Use `done` callback sparingly
- Test both success and error paths

---

## Monitoring Test Health

### Metrics to Track
- [ ] Code coverage trend (should be ≥80%)
- [ ] Test execution time (should be <5 min)
- [ ] Flaky tests (should be 0)
- [ ] Test pass rate (should be 100% on main)

### Regular Maintenance
- Run `npm test -- --listTests` to see all tests
- Run `npm test -- --coverage` weekly
- Review slow tests: `npm test -- --detectOpenHandles`
- Refactor tests if duplicated

---

*This testing strategy ensures high quality, prevents regressions, and enables confident refactoring. Quality is non-negotiable.*
