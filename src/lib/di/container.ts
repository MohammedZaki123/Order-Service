import "reflect-metadata";
import {container} from "tsyringe";
import {TOKENS} from "./tokens";
import {Logger} from "../logger/logger";
import {cacheProvider} from "../cache/init";
import {messageBroker} from "../messaging/init";
import {OrderService} from "../../app/order/service/order.service";
import {OrderStatusService} from "../../app/order/service/order-status.service";
import {OrderController} from "../../app/order/controller/order.controller";
import {CoreDataCacheService} from "../../app/order/service/core-data-cache.service";
import {PermissionCacheService} from "../rbac/permission.cache.service";
import {env} from "../config/env";

// Infrastructure
container.registerSingleton<Logger>(TOKENS.Logger, Logger);
container.registerInstance(TOKENS.CacheProvider, cacheProvider);
container.registerInstance(TOKENS.MessageBroker, messageBroker);
// container.registerSingleton(TOKENS.WsServer, ws)

const kashierClient = new KashierClient({
    baseUrl: env.kashier.baseUrl,
    merchantId: env.kashier.merchantId,
    apiKey: env.kashier.apiKey,
    secretKey: env.kashier.secretKey,
    paymentType: env.kashier.paymentType,
    serverWebhookUrl: env.kashier.webhookUrl,
    merchantRedirect: env.kashier.returnUrl,
    failureRedirectEnabled: false,
    sessionTimeoutSec: env.payments.sessionTimeoutMin * 60,
});




// Payment Module
import {KashierClient} from "../../pkg/payments/kashier/kashier.client";
import {PaymentService} from "../../app/payment/service/payment.service";
import {PaymentWebhookService} from "../../app/payment/service/webhook.service";
import {PaymentController} from "../../app/payment/controller/payment.controller";
import {PresenceService} from "../../app/agent/service/presence.service";
import {AssignmentService} from "../../app/assignment/service/assignment.service";
import {EarningService} from "../../app/agent/service/earning.service";
import {AgentService} from "../../app/agent/service/agent.service";
import {FinanceService} from "../../app/finance/service/finance.service";
import {FinanceController} from "../../app/finance/controller/finance.controller";
import {DeliveryLifecycleService} from "../../app/agent/service/delivery-lifecycle.service";
import {AgentController} from "../../app/agent/controller/agent.controller";
import {AssignmentController} from "../../app/assignment/controller/assignment.controller";
import {SettlementService} from "../../app/finance/service/settlement.service";


// Order Module
container.registerSingleton<OrderService>(TOKENS.OrderService, OrderService);
container.registerSingleton<CoreDataCacheService>(TOKENS.CoreDataCacheService, CoreDataCacheService);
container.registerSingleton<PermissionCacheService>(TOKENS.PermissionCacheService, PermissionCacheService);
container.registerSingleton<OrderStatusService>(TOKENS.OrderStatusService, OrderStatusService);
container.registerSingleton<OrderController>(TOKENS.OrderController, OrderController);

// Payment Module Registrations
container.registerInstance(TOKENS.KashierProvider, kashierClient);
container.registerSingleton<PaymentService>(TOKENS.PaymentService, PaymentService);
container.registerSingleton<PaymentWebhookService>(TOKENS.PaymentWebhookService, PaymentWebhookService);
container.registerSingleton<PaymentController>(TOKENS.PaymentController, PaymentController);

// Delivery Module Registrations (Phase 3)
container.registerSingleton<PresenceService>(TOKENS.PresenceService, PresenceService);
container.registerSingleton<AssignmentService>(TOKENS.AssignmentService, AssignmentService);
container.registerSingleton<DeliveryLifecycleService>(TOKENS.DeliveryLifecycleService, DeliveryLifecycleService);
container.registerSingleton<EarningService>(TOKENS.EarningService, EarningService);
container.registerSingleton<AgentService>(TOKENS.AgentService, AgentService);
container.registerSingleton<AgentController>(TOKENS.AgentController, AgentController);
container.registerSingleton<AssignmentController>(TOKENS.AssignmentController, AssignmentController);

// Finance Module Registrations (Phase 4)
container.registerSingleton<FinanceService>(TOKENS.FinanceService, FinanceService);
container.registerSingleton<FinanceController>(TOKENS.FinanceController, FinanceController);
container.registerSingleton<SettlementService>(TOKENS.SettlementService, SettlementService);

export {container};
