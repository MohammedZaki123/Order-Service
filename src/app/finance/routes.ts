import {Router} from "express";
import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {authenticate} from "../../lib/auth/guard";
import {requireRegion} from "../../lib/sharding/region-resolver";
import {rbac, requireRestaurantMember} from "../../lib/auth/rbac";
import {idempotency} from "../../lib/idempotency/idempotency";
import {FinanceController} from "./controller/finance.controller";

const router = Router();
const controller = container.resolve<FinanceController>(TOKENS.FinanceController);

// Get restaurant balance (owner/manager view)
// Pattern: GET /restaurant/:restaurantId/finance/balance
router.get(
    "/restaurants/:restaurantId/balance",
    authenticate,
    requireRegion,
    requireRestaurantMember("restaurantId"),
    rbac({resource: "finance", action: "read"}),
    controller.getBalance
);

// Get restaurant payout history (owner/manager view)
router.get(
    "/restaurants/:restaurantId/payouts",
    authenticate,
    requireRegion,
    requireRestaurantMember("restaurantId"),
    rbac({resource: "finance", action: "read"}),
    controller.listPayouts
);

// Record a payout (admin-only via direct call, not exposed to restaurant)
// admin can call POST /admin/restaurant/:restaurantId/payouts
router.post(
    "/admin/restaurants/:restaurantId/payouts",
    authenticate,
    requireRegion,
    rbac({resource: "finance", action: "payout_create"}),
    idempotency({strict: true}),
    controller.recordPayout
);

export default router;
