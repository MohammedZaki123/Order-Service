/**
 * Minimal DI container for integration tests.
 * Registers only what's needed for Order Service HTTP endpoints,
 * with infrastructure mocked to avoid real connections.
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '../../src/lib/di/tokens';

// ── Mock Infrastructure ──────────────────────────────────────────────────────

const mockCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
};

const mockBroker = {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    declareTopology: jest.fn().mockResolvedValue(undefined),
};

const mockWs = {
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    emit: jest.fn(),
};

const mockKashier = {
    createSession: jest.fn().mockResolvedValue({
        providerSessionId: 'mock-provider-session-id',
        redirectUrl: 'https://mock-pay.kashier.io/session/mock',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        rawResponse: {},
    }),
    refund: jest.fn().mockResolvedValue({ success: true, providerReferenceId: 'ref_mock' }),
    verifyWebhook: jest.fn().mockReturnValue(true),
};

// ── Service Imports ──────────────────────────────────────────────────────────
import { Logger } from '../../src/lib/logger/logger';
import { OrderService } from '../../src/app/order/service/order.service';
import { OrderStatusService } from '../../src/app/order/service/order-status.service';
import { OrderController } from '../../src/app/order/controller/order.controller';
import { CoreDataCacheService } from '../../src/app/order/service/core-data-cache.service';
import { PermissionCacheService } from '../../src/lib/rbac/permission.cache.service';
import { PaymentService } from '../../src/app/payment/service/payment.service';
import { PaymentWebhookService } from '../../src/app/payment/service/webhook.service';
import { PaymentController } from '../../src/app/payment/controller/payment.controller';
import { PresenceService } from '../../src/app/agent/service/presence.service';
import { AssignmentService } from '../../src/app/assignment/service/assignment.service';
import { DeliveryLifecycleService } from '../../src/app/agent/service/delivery-lifecycle.service';
import { EarningService } from '../../src/app/agent/service/earning.service';
import { AgentService } from '../../src/app/agent/service/agent.service';
import { AgentController } from '../../src/app/agent/controller/agent.controller';
import { AssignmentController } from '../../src/app/assignment/controller/assignment.controller';
import { FinanceService } from '../../src/app/finance/service/finance.service';
import { FinanceController } from '../../src/app/finance/controller/finance.controller';
import { SettlementService } from '../../src/app/finance/service/settlement.service';

// ── Register Mocked Infrastructure ──────────────────────────────────────────
container.registerSingleton<Logger>(TOKENS.Logger, Logger);
container.registerInstance(TOKENS.CacheProvider, mockCache);
container.registerInstance(TOKENS.MessageBroker, mockBroker);
container.registerInstance(TOKENS.WsServer, mockWs);
container.registerInstance(TOKENS.KashierProvider, mockKashier);

// ── Register Services ────────────────────────────────────────────────────────
container.registerSingleton<OrderStatusService>(TOKENS.OrderStatusService, OrderStatusService);
container.registerSingleton<CoreDataCacheService>(TOKENS.CoreDataCacheService, CoreDataCacheService);
container.registerSingleton<PermissionCacheService>(TOKENS.PermissionCacheService, PermissionCacheService);
container.registerSingleton<OrderService>(TOKENS.OrderService, OrderService);
container.registerSingleton<OrderController>(TOKENS.OrderController, OrderController);

// Payment
container.registerSingleton<PaymentService>(TOKENS.PaymentService, PaymentService);
container.registerSingleton<PaymentWebhookService>(TOKENS.PaymentWebhookService, PaymentWebhookService);
container.registerSingleton<PaymentController>(TOKENS.PaymentController, PaymentController);

// Delivery
container.registerSingleton<PresenceService>(TOKENS.PresenceService, PresenceService);
container.registerSingleton<AssignmentService>(TOKENS.AssignmentService, AssignmentService);
container.registerSingleton<DeliveryLifecycleService>(TOKENS.DeliveryLifecycleService, DeliveryLifecycleService);
container.registerSingleton<EarningService>(TOKENS.EarningService, EarningService);
container.registerSingleton<AgentService>(TOKENS.AgentService, AgentService);
container.registerSingleton<AgentController>(TOKENS.AgentController, AgentController);
container.registerSingleton<AssignmentController>(TOKENS.AssignmentController, AssignmentController);

// Finance
container.registerSingleton<FinanceService>(TOKENS.FinanceService, FinanceService);
container.registerSingleton<FinanceController>(TOKENS.FinanceController, FinanceController);
container.registerSingleton<SettlementService>(TOKENS.SettlementService, SettlementService);

export { container, mockCache, mockBroker, mockWs, mockKashier };
