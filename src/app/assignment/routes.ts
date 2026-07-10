import {Router} from "express";
import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {authenticate} from "../../lib/auth/guard";
import {idempotency} from "../../lib/idempotency/idempotency";
import {requireRegion} from "../../lib/sharding/region-resolver";
import {rbac} from "../../lib/auth/rbac";
import {AssignmentController} from "./controller/assignment.controller";

const router = Router();
const controller = container.resolve<AssignmentController>(TOKENS.AssignmentController);

// Manual delivery assignment (restaurant staff/manager only)
// Pattern: POST /restaurant/{restaurantId}/branch/{branchId}/deliveries/assign/{orderId}
router.post(
    "/admin/orders/:publicId/assign",
    authenticate,
    requireRegion,
    rbac({resource: "deliveries", action: "assign"}),
    idempotency({strict: true}),
    controller.assign
);

// Reassignment (when delivery agent rejects)
// router.post(
//     "/restaurant/:restaurantId/branch/:branchId/deliveries/reassign/:orderId",
//     authenticate,
//     requireRegion,
//     rbac({resource: "deliveries", action: "assign"}),
//     controller.reassign
// );

export default router;
