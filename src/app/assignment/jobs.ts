/**
 * Background jobs for delivery assignment.
 *
 * Job runs every minute to:
 * 1. Scan for orders in READY status without a delivery agent
 * 2. For each ready order, broadcast to nearby agents (based on Redis GeoSearch)
 * 3. Agents have AGENT_ACCEPT_TIMEOUT_SEC to accept or reject
 * 4. First acceptance wins; others are auto-rejected
 */


import {register} from "../../lib/jobs/job-registry";
import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {env} from "../../lib/config/env";
import {logger} from "../../lib/logger/logger";
import {AssignmentService} from "./service/assignment.service";

/**
 * Registers one assignment-tick job per configured region. Each fires every
 * ASSIGNMENT_TICK_SEC seconds — translated to a 6-field cron expression
 * (`*\/N * * * * *`). Per-region jobs let one region's slow tick not block
 * another's.
 *
 * Idempotent: safe to call once per process boot.
 */
export function registerAssignmentJobs(): void {
    const everyNSec = `*/${env.delivery.assignmentTickSec} * * * * *`;
    for (const region of env.regions) {
        register({
            name: `assignment-tick:${region}`,
            cron: everyNSec,
            handler: async () => {
                const assignmentService = container.resolve<AssignmentService>(TOKENS.AssignmentService);
                const result = await assignmentService.tickRegion(region);
                if (result.processed > 0) {
                    logger.info("assignment.tick", {region, ...result});
                }
            },
        });
    }
}


// import { register } from "../../lib/jobs/scheduler";
// import { logger } from "../../lib/logger/logger";
// import { container } from "../../lib/di/container";
// import { TOKENS } from "../../lib/di/tokens";
// import { db } from "../../lib/knex/knex";
// import { env } from "../../lib/config/env";
// import * as orderRepo from "../order/repository/order.repo";
// import { AssignmentService } from "./service/assignment.service";
// import { OrderStatus } from "../order/enums";
// import { Server } from "socket.io";
// import { cacheProvider } from "../../lib/cache/init";
//
// let assignmentJobHandle: NodeJS.Timeout | null = null;
//
// export function registerAssignmentJobs(): void {
//     register({
//         key: "assignment:ready-orders",
//         start: async () => {
//             logger.info("assignment job started (runs every 60 seconds)");
//             assignmentJobHandle = setInterval(async () => {
//                 try {
//                     await tryAssignReadyOrders();
//                 } catch (err) {
//                     logger.error("assignment job error", {
//                         error: err instanceof Error ? err.message : String(err),
//                     });
//                 }
//             }, 60 * 1000); // Run every minute
//         },
//         stop: async () => {
//             if (assignmentJobHandle) {
//                 clearInterval(assignmentJobHandle);
//                 assignmentJobHandle = null;
//             }
//             logger.info("assignment job stopped");
//         },
//     });
// }
//
// /**
//  * Scan all regions for orders in READY status without assignment.
//  * For each eligible order, broadcast to nearby agents.
//  */
// async function tryAssignReadyOrders(): Promise<void> {
//     for (const region of env.regions) {
//         try {
//             await processRegionReadyOrders(region);
//         } catch (err) {
//             logger.warn("region ready order processing failed", {
//                 region,
//                 error: err instanceof Error ? err.message : String(err),
//             });
//         }
//     }
// }
//
// /**
//  * For a single region, fetch all READY orders without an agent and broadcast.
//  */
// async function processRegionReadyOrders(region: string): Promise<void> {
//     const conn = db(region);
//     const readyOrders = await orderRepo.findOrdersByStatus(
//         region,
//         [OrderStatus.READY],
//         conn
//     );
//
//     const unassignedOrders = readyOrders.filter((o) => !o.deliveryAgentId);
//
//     if (unassignedOrders.length === 0) {
//         return;
//     }
//
//     const assignmentService = container.resolve<AssignmentService>(
//         TOKENS.AssignmentService
//     );
//     const presenceService = container.resolve(TOKENS.PresenceService);
//     const io = container.resolve<Server>(TOKENS.WsServer);
//
//     for (const order of unassignedOrders) {
//         try {
//             await broadcastOrderToAgents(
//                 order,
//                 region,
//                 assignmentService,
//                 io,
//                 presenceService
//             );
//         } catch (err) {
//             logger.warn("broadcast failed for order", {
//                 orderId: order.publicId,
//                 error: err instanceof Error ? err.message : String(err),
//             });
//         }
//     }
// }
//
// /**
//  * Broadcast an order to nearby agents.
//  * Each agent has AGENT_ACCEPT_TIMEOUT_SEC to accept via WebSocket.
//  * First acceptance wins; others are auto-rejected.
//  */
// async function broadcastOrderToAgents(
//     order: any,
//     region: string,
//     assignmentService: AssignmentService,
//     io: Server,
//     presenceService: any
// ): Promise<void> {
//
//     // Find nearby available agents
//     const nearbyAgents = await presenceService.findNearbyAgents(
//         region,
//         order.branchLng,
//         order.branchLat,
//         env.delivery.assignmentRadiusMeters,
//         5 // broadcast to top 5 nearest agents
//     );
//
//     if (nearbyAgents.length === 0) {
//         logger.debug("no nearby agents for order", {
//             orderId: order.publicId,
//             region,
//         });
//         return;
//     }
//
//     // Create a broadcast key for this order assignment
//     const broadcastKey = `assignment:broadcast:${order.id}`;
//     const broadcastLockKey = `${broadcastKey}:lock`;
//
//     // Only broadcast once (use a lock)
//     const acquired = await cacheProvider.trySet(broadcastLockKey, "1", 300);
//     if (!acquired) {
//         return; // Already broadcasted recently
//     }
//
//     logger.info("broadcasting order to agents", {
//         orderId: order.publicId,
//         agentCount: nearbyAgents.length,
//         region,
//     });
//
//     const broadcastPayload = {
//         orderId: order.publicId,
//         branchId: order.branchId,
//         restaurantId: order.restaurantId,
//         subtotal: order.subtotal,
//         deliveryFee: order.deliveryFee,
//         currency: order.currency,
//         customerLocation: {
//             lat: order.deliveryLat,
//             lng: order.deliveryLng,
//         },
//         acceptTimeoutSec: env.delivery.agentAcceptTimeoutSec,
//         ts: new Date().toISOString(),
//     };
//
//     // Emit to each nearby agent
//     for (const agentId of nearbyAgents) {
//         io.to(`agent:${agentId}`).emit("order.assignment_offered", broadcastPayload);
//
//         // Track offer sent
//         await cacheProvider.set(
//             `assignment:offer:${order.id}:${agentId}`,
//             "offered",
//             env.delivery.agentAcceptTimeoutSec
//         );
//     }
//
//     // Set up acceptance timeout: if no agent accepts within timeout, release broadcast lock
//     // (this allows a retry on next cycle)
//     setTimeout(async () => {
//         // Check if any agent accepted
//         const accepted = await cacheProvider.get(`assignment:accepted:${order.id}`);
//         if (!accepted) {
//             // No acceptance, release lock for retry
//             await cacheProvider.del(broadcastLockKey);
//             logger.warn("assignment offer expired (no acceptances)", {
//                 orderId: order.publicId,
//             });
//         }
//     }, (env.delivery.agentAcceptTimeoutSec + 5) * 1000);
// }
//



