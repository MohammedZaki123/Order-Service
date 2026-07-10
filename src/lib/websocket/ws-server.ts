// import type {Server as HttpServer} from "http";
// import {Server as IOServer} from "socket.io";
// import {createAdapter} from "@socket.io/redis-adapter";
// import {toMs} from "../../pkg/utils/time";
// import {env} from "../config/env";
// import {logger} from "../logger/logger";
// import {redisClient} from "../cache/init";
// import {authenticateHandshake, permittedChannels} from "./ws-auth";
// import {container} from "../di/container";
// import {TOKENS} from "../di/tokens";
// import {AssignmentService} from "../../app/assignment/service/assignment.service";
//
// /**
//  * Attaches a socket.io server on /ws with a Redis pub/sub adapter.
//  * Multi-process fan-out is automatic: `io.to(room).emit(...)` on any worker
//  * reaches every connected socket in every worker for that room.
//  *
//  * Reuses the shared `redisClient` for PUBLISH; duplicates it for the
//  * subscriber (ioredis can't serve commands once in subscribe mode).
//  */
// export function attachWsServer(httpServer: HttpServer): IOServer {
//     const io = new IOServer(httpServer, {
//         path: "/ws",
//         serveClient: false,
//         pingInterval: toMs(env.ws.heartbeatSec,'s'),
//     });
//     io.adapter(createAdapter(redisClient, redisClient.duplicate()));
//
//     io.use((socket, next) => {
//         try {
//             const user = authenticateHandshake(socket.handshake);
//             socket.data.user = user;
//             socket.data.allowed = permittedChannels(user);
//             next();
//         } catch (err) {
//             next(err as Error);
//         }
//     });
//
//     io.on("connection", (socket) => {
//         const allowed: Set<string> = socket.data.allowed;
//         const user = socket.data.user;
//         socket.emit("hello", {allowedChannels: [...allowed]});
//
//         socket.on("subscribe", (channel: string, ack?: (res: unknown) => void) => {
//             if (typeof channel !== "string" || !allowed.has(channel)) {
//                 ack?.({ok: false, error: "not permitted"});
//                 return;
//             }
//             socket.join(channel);
//             ack?.({ok: true});
//             socket.emit("subscribed", {channel});
//         });
//
//         socket.on("unsubscribe", (channel: string) => {
//             if (typeof channel === "string") socket.leave(channel);
//         });
//
//         socket.on("assignment.accept", async (payload: { orderId: string; region: string }, ack?: (res: any) => void) => {
//             try {
//                 if (user.role !== "delivery_agent") {
//                     ack?.({ ok: false, error: "Forbidden: User is not a delivery agent" });
//                     return;
//                 }
//                 const assignmentService = container.resolve<AssignmentService>(TOKENS.AssignmentService);
//                 const order = await assignmentService.claim(payload.orderId, user.userId, payload.region);
//                 // ack?.({ ok: true, orderId: order.publicId, status: order.status });
//             } catch (err) {
//                 logger.warn("WS assignment.accept error", {
//                     userId: user.userId,
//                     error: err instanceof Error ? err.message : String(err)
//                 });
//                 ack?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
//             }
//         });
//
//         socket.on("assignment.reject", async (payload: { orderId: string; region: string }, ack?: (res: any) => void) => {
//             try {
//                 if (user.role !== "delivery_agent") {
//                     ack?.({ ok: false, error: "Forbidden: User is not a delivery agent" });
//                     return;
//                 }
//                 const assignmentService = container.resolve<AssignmentService>(TOKENS.AssignmentService);
//                 await assignmentService.reject(payload.orderId, user.userId);
//                 ack?.({ ok: true });
//             } catch (err) {
//                 logger.warn("WS assignment.reject error", {
//                     userId: user.userId,
//                     error: err instanceof Error ? err.message : String(err)
//                 });
//                 ack?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
//             }
//         });
//
//         socket.on("disconnect", (reason) => {
//             logger.info("ws disconnected", {userId: user.userId, reason});
//         });
//     });
//
//     return io;
// }
import type {Server as HttpServer} from "http";
import {Server as IOServer} from "socket.io";
import {createAdapter} from "@socket.io/redis-adapter";
import {toMs} from "../../pkg/utils/time";
import {env} from "../config/env";
import {logger} from "../logger/logger";
import {redisClient} from "../cache/init";
import {authenticateHandshake, permittedChannels} from "./ws-auth";

/**
 * Attaches a socket.io server on /ws with a Redis pub/sub adapter.
 * Multi-process fan-out is automatic: `io.to(room).emit(...)` on any worker
 * reaches every connected socket in every worker for that room.
 *
 * Reuses the shared `redisClient` for PUBLISH; duplicates it for the
 * subscriber (ioredis can't serve commands once in subscribe mode).
 */
export function attachWsServer(httpServer: HttpServer): IOServer {
    const io = new IOServer(httpServer, {
        path: "/ws",
        serveClient: false,
        pingInterval: toMs(env.ws.heartbeatSec,'s'),
    });
    io.adapter(createAdapter(redisClient, redisClient.duplicate()));

    io.use((socket, next) => {
        try {
            const user = authenticateHandshake(socket.handshake);
            socket.data.user = user;
            socket.data.allowed = permittedChannels(user);
            next();
        } catch (err) {
            next(err as Error);
        }
    });

    io.on("connection", (socket) => {
        const allowed: Set<string> = socket.data.allowed;
        const user = socket.data.user;
        socket.emit("hello", {allowedChannels: [...allowed]});

        socket.on("subscribe", (channel: string, ack?: (res: unknown) => void) => {
            if (typeof channel !== "string" || !allowed.has(channel)) {
                ack?.({ok: false, error: "not permitted"});
                return;
            }
            socket.join(channel);
            ack?.({ok: true});
            socket.emit("subscribed", {channel});
        });

        socket.on("unsubscribe", (channel: string) => {
            if (typeof channel === "string") socket.leave(channel);
        });

        socket.on("disconnect", (reason) => {
            logger.info("ws disconnected", {userId: user.userId, reason});
        });
    });

    return io;
}



