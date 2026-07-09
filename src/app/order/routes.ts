import {Router} from "express";
import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {OrderController} from "./controller/order.controller";
import {authenticate} from "../../lib/auth/guard";
import {idempotency} from "../../lib/idempotency/idempotency";
import { requireRegion } from "../../lib/sharding/region-resolver";
import { withCache } from "../../lib/cache/withCache";
import {rbac, requireBranchAccess, requireRestaurantMember} from "../../lib/auth/rbac";

export const orderRouter = Router();
const orderController = container.resolve<OrderController>(TOKENS.OrderController);

// Place order (customer, creates new order)
orderRouter.post("/orders",
    authenticate,
    requireRegion, 
    idempotency({strict: true}), 
    orderController.placeOrder
);

// Get order by public ID (customer can see their own, restaurant staff can see their orders)
orderRouter.get("/orders/:publicId",
    authenticate, 
    requireRegion,
    orderController.getOrder
);

// List customer's own orders (with cursor pagination)
orderRouter.get("/customer/orders",
    authenticate, 
    requireRegion,
    orderController.listMyOrders
);

// List restaurant's orders by branch (with cursor pagination and filtering)    
// Pattern: GET /restaurant/:restaurantId/branch/:branchId/orders?status=&cursor=&limit=
orderRouter.get(
    "/restaurants/:restaurantId/branches/:branchId/orders",
    authenticate,
    requireRegion,
    requireRestaurantMember("restaurantId"),
    requireBranchAccess("branchId"),
    rbac({resource: "orders", action: "read"}),
    withCache(60),
    orderController.listRestaurantOrders
);

// Update order status (restaurant staff transitions order through lifecycle)
// Pattern: PATCH /restaurant/:restaurantId/branch/:branchId/orders/:orderId/status
orderRouter.patch(
    "/restaurants/:restaurantId/branches/:branchId/orders/:publicId/status",
    authenticate,
    requireRegion,
    rbac({resource: "orders", action: "update"}),
    idempotency({strict: true}), 
    orderController.updateStatus
);

// Customer-only cancel endpoint (status target is implicit: cancelled).
orderRouter.patch(
    "/customer/orders/:publicId/status",
    authenticate,
    requireRegion,
    idempotency({strict: true}),
    orderController.updateStatus,
);

// ── Admin override (any transition the matrix allows for `admin`) ───────
orderRouter.patch(
    "/admin/orders/:publicId/status",
    authenticate,
    requireRegion,
    rbac({resource: "orders", action: "cancel"}),
    idempotency({strict: true}),
    orderController.updateStatus,
);



