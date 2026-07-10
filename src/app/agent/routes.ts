import {Router} from "express";
import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {authenticate} from "../../lib/auth/guard";
import {requireRegion} from "../../lib/sharding/region-resolver";
import {AgentController} from "./controller/agent.controller";
import { requireAgent } from "../../lib/auth/rbac";
import { idempotency } from "../../lib/idempotency/idempotency";

export const router = Router();
const controller = container.resolve<AgentController>(TOKENS.AgentController);

// Agent presence management (ping every 5 minutes to keep online)
router.post("/agents/presence/online", authenticate,requireAgent, requireRegion, controller.goOnline);
router.post("/agents/presence/offline", authenticate,requireAgent, requireRegion, controller.goOffline);
router.post("/agents/presence/ping", authenticate,requireAgent, requireRegion, controller.goOnline);

// Agent task list and earnings (agent-specific queries)
router.get("/agents/tasks", authenticate, requireAgent,requireRegion, controller.listTasks);
router.get("/agents/earnings", authenticate,requireAgent, requireRegion, controller.getEarnings);

// Delivery lifecycle management (agent updates their assigned order status)
// Pattern: PATCH /orders/{orderId}/delivery/status
// body: { action: 'accepted' | 'rejected' | 'picked' | 'delivered', reason?: string }
router.patch("/agents/orders/:publicId/status", authenticate,requireAgent, requireRegion, idempotency({strict: true}),controller.updateDeliveryStatus);

// Agent position updates (streamed to customer during delivery)
// router.post("/orders/:orderId/delivery/position", authenticate,requireAgent,requireRegion, idempotency({strict: true}), controller.updatePosition);

// Accept/reject delivery offers
router.post("/agents/orders/:publicId/accept", authenticate, requireAgent, requireRegion, idempotency({strict: true}), controller.acceptOrder);
router.post("/agents/orders/:publicId/reject", authenticate, requireAgent, requireRegion,idempotency({strict: true}), controller.rejectOrder);

export default router;
