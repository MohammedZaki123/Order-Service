export const TOKENS = {
    // infra
    Logger: Symbol.for("Logger"),
    CacheProvider: Symbol.for("CacheProvider"),
    MessageBroker: Symbol.for("MessageBroker"),
    CoreClient: Symbol.for("CoreClient"),
    BranchClient: Symbol.for("BranchClient"),
    RBACClient: Symbol.for("RBACClient"),
    AddressClient: Symbol.for("AddressClient"),
    WsServer: Symbol.for("WsServer"),
    PermissionCacheService: Symbol.for("PermissionCacheService"),
    CoreDataCacheService: Symbol.for("CoreDataCacheService"),


    // order
    OrderService: Symbol.for("OrderService"),
    OrderStatusService: Symbol.for("OrderStatusService"),
    OrderController: Symbol.for("OrderController"),

    // payment
    KashierProvider: Symbol.for("KashierProvider"),
    PaymentService: Symbol.for("PaymentService"),
    PaymentController: Symbol.for("PaymentController"),
    PaymentWebhookService: Symbol.for("PaymentWebhookService"),

    // delivery (phase 3)
    PresenceService: Symbol.for("PresenceService"),
    AssignmentService: Symbol.for("AssignmentService"),
    DeliveryLifecycleService: Symbol.for("DeliveryLifecycleService"),
    EarningService: Symbol.for("EarningService"),
    AgentService: Symbol.for("AgentService"),
    AgentController: Symbol.for("AgentController"),
    AssignmentController: Symbol.for("AssignmentController"),

    // finance (phase 4)
    FinanceService: Symbol.for("FinanceService"),
    FinanceController: Symbol.for("FinanceController"),
    SettlementService: Symbol.for("SettlementService"),
};
