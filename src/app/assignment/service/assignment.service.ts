import {inject, injectable} from "tsyringe";
import {Server as IoServer} from "socket.io";
import {container} from "../../../lib/di/container";
import {TOKENS} from "../../../lib/di/tokens";
import {env} from "../../../lib/config/env";
import {db} from "../../../lib/knex/knex";
import {logger} from "../../../lib/logger/logger";
import {ICacheProvider} from "../../../pkg/cache/cache.interface";
import {getBranch} from "../../../lib/core-client/branch.client";
import {OrderEntity} from "../../order/entity/order.entity";
import {
    findOrderByPublicId,
    findReadyUnassigned,
    claimReadyOrderForAgent,
} from "../../order/repository/order.repo";
import {OrderStatusResponseDTO} from "../../order/dto/order.response.dto";
import {DeliveryTaskResponseDTO} from "../../agent/dto/agent.response.dto";
import {PresenceService} from "../../agent/service/presence.service";
import {
    OfferNotFoundOrExpiredError,
    NotInCandidateListError,
    OrderAlreadyClaimedError,
    OrderNotInReadyStateError,
} from "../../agent/errors";

interface OfferPayload {
    orderId: string;
    branch: {id: number; lat: number; lng: number; name: string; addressText: string};
    dropoff: {lat: number; lng: number; addressText: string};
    total: number;
    currency: string;
    paymentMethod: string;
    expiresAt: string;
}

@injectable()
export class AssignmentService {
    constructor(
        @inject(TOKENS.CacheProvider) private readonly cache: ICacheProvider,
        @inject(TOKENS.PresenceService) private readonly presence: PresenceService,
    ) {}

    private get io(): IoServer {
        return container.resolve<IoServer>(TOKENS.WsServer);
    }

    // ── Cache key helpers ──────────────────────────────────────────────────

    static offerKey(orderPublicId: string): string {
        return `offer:order:${orderPublicId}`;
    }

    static claimKey(orderPublicId: string): string {
        return `claim:order:${orderPublicId}`;
    }

    static attemptsKey(orderPublicId: string): string {
        return `assign:attempts:${orderPublicId}`;
    }

    // ── Worker tick ────────────────────────────────────────────────────────

    /**
     * Worker entrypoint: fetches up to `env.delivery.batch` READY unassigned
     * orders for the region and tries to broadcast an offer to nearby agents.
     */
    async tickRegion(region: string): Promise<{processed: number; offered: number; skipped: number}> {
        const conn = db(region);
        const orders = await findReadyUnassigned(env.delivery.batch, conn);
        let offered = 0;
        let skipped = 0;

        for (const order of orders) {
            const result = await this.tryAssign(order, region).catch((err) => {
                logger.error("tryAssign failed", {
                    publicId: order.publicId,
                    error: (err as Error).message,
                });
                return "error" as const;
            });
            if (result === "offered") offered++;
            else skipped++;
        }

        return {processed: orders.length, offered, skipped};
    }

    // ── Offer broadcast ────────────────────────────────────────────────────

    /**
     * Find nearby candidates → broadcast `task.offered` → set a single offer
     * marker whose value is the comma-separated list of candidate agent IDs.
     *
     * Acceptance is owned by `claim()` (called from POST /agents/orders/:id/accept).
     * Rejection removes the caller from the candidate list via `reject()`.
     */
    async tryAssign(
        order: OrderEntity,
        region: string,
    ): Promise<"offered" | "skipped" | "exhausted" | "no-candidates"> {
        // Already broadcasting for this order? Skip until the offer expires.
        if (await this.cache.exists(AssignmentService.offerKey(order.publicId))) return "skipped";

        // Cap re-broadcast attempts — beyond the cap emit an admin alert.
        const attemptsRaw = await this.cache.get(AssignmentService.attemptsKey(order.publicId));
        const attempts = Number(attemptsRaw ?? 0);
        if (attempts >= env.delivery.maxAttempts) {
            this.io.to("admin:alerts").emit("assignment.exhausted", {
                orderId: order.publicId,
                attempts,
            });
            return "exhausted";
        }
        
        // GEOSEARCH using the snapshotted branch coordinates on the order row.
        const candidates = await this.findCandidates(region, order.branchLng, order.branchLat);
        if (candidates.length === 0) {
            await this.cache.incr(AssignmentService.attemptsKey(order.publicId));
            await this.cache.expire(AssignmentService.attemptsKey(order.publicId), 3600);
            return "no-candidates";
        }

        // Atomic SETNX — only one worker/process broadcasts per offer window.
        const offerSet = await this.cache.trySet(
            AssignmentService.offerKey(order.publicId),
            candidates.join(","),
            env.delivery.offerTtlSec,
        );
        if (!offerSet) return "skipped";

        await this.cache.incr(AssignmentService.attemptsKey(order.publicId));
        await this.cache.expire(AssignmentService.attemptsKey(order.publicId), 36000);

        // Branch details are best-effort (display only); failures do not block.
        const branch = await getBranch(order.branchId).catch(() => null);
        const expiresAt = new Date(Date.now() + env.delivery.offerTtlSec * 1000).toISOString();

        const payload: OfferPayload = {
            orderId: order.publicId,
            branch: {
                id: order.branchId,
                lat: order.branchLat,
                lng: order.branchLng,
                name: branch?.name ?? "",
                addressText: branch?.addressText ?? "",
            },
            dropoff: {
                lat: order.deliveryLat,
                lng: order.deliveryLng,
                addressText: order.deliveryAddressTextSnapshot,
            },
            total: order.total,
            currency: order.currency,
            paymentMethod: order.paymentMethod,
            expiresAt,
        };

        for (const agentId of candidates) {
            this.io.to(`agent:${agentId}`).emit("task.offered", payload);
        }

        logger.info("assignment.broadcast", {
            publicId: order.publicId,
            candidates,
            attempts: attempts + 1,
        });
        return "offered";
    }

    // ── Accept ─────────────────────────────────────────────────────────────

    /**
     * Atomic claim. The first agent to call this wins; concurrent callers get
     * `OrderAlreadyClaimedError`. Returns the full `DeliveryTaskResponseDTO`
     * on success.
     */
    async claim(
        publicId: string,
        agentId: number,
        region: string,
    ): Promise<DeliveryTaskResponseDTO> {
        // Verify the agent is in the active offer.
        const offered = await this.cache.get(AssignmentService.offerKey(publicId));
        if (!offered) throw OfferNotFoundOrExpiredError;

        const candidateIds = offered.split(",").map(Number);
        if (!candidateIds.includes(agentId)) throw NotInCandidateListError;

        // First acceptor wins — atomic SETNX.
        const ok = await this.cache.trySet(
            AssignmentService.claimKey(publicId),
            String(agentId),
            env.delivery.claimTtlSec,
        );
        if (!ok) throw OrderAlreadyClaimedError;

        const conn = db(region);
        const trx = await conn.transaction();
        let updated: OrderEntity;

        try {
            const order = await findOrderByPublicId(publicId, trx);
            if (!order) {
                await this.cache.del(AssignmentService.claimKey(publicId));
                throw OrderNotInReadyStateError;
            }

            const claimed = await claimReadyOrderForAgent(publicId, agentId, trx);
            if (!claimed) {
                await this.cache.del(AssignmentService.claimKey(publicId));
                throw OrderNotInReadyStateError;
            }

            updated = claimed;
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            await this.cache.del(AssignmentService.claimKey(publicId));
            throw err;
        }

        await this.presence.markBusy(agentId, region);

        // Fan-out: winner gets `task.assigned`, losers get `offer.cancelled`.
        const losers = candidateIds.filter((id) => id !== agentId);
        const branch = await getBranch(updated.branchId).catch(() => null);
        const taskDto = DeliveryTaskResponseDTO.from(updated, branch ?? undefined);
        const statusDto = OrderStatusResponseDTO.from(updated);

        this.io.to(`agent:${agentId}`).emit("task.assigned", taskDto);
        for (const loser of losers) {
            this.io
                .to(`agent:${loser}`)
                .emit("offer.cancelled", {orderId: publicId, reason: "claimed_by_other"});
        }
        this.io.to(`customer:${updated.customerId}`).emit("order.status_changed", statusDto);
        this.io.to(`branch:${updated.branchId}`).emit("order.status_changed", statusDto);

        // Drop the offer marker (claim TTL keeps the idempotency lock).
        await this.cache.del(AssignmentService.offerKey(publicId));

        logger.info("assignment.claimed", {publicId, agentId, region});
        return taskDto;
    }

    // ── Reject ─────────────────────────────────────────────────────────────

    /**
     * Removes the caller from the candidate list. If the list empties the
     * offer key is deleted immediately (no need to wait for TTL expiry).
     */
    async reject(publicId: string, agentId: number): Promise<void> {
        const offered = await this.cache.get(AssignmentService.offerKey(publicId));
        if (!offered) throw OfferNotFoundOrExpiredError;

        const candidateIds = offered.split(",").map(Number);
        if (!candidateIds.includes(agentId)) throw NotInCandidateListError;

        const remaining = candidateIds.filter((id) => id !== agentId);
        if (remaining.length === 0) {
            await this.cache.del(AssignmentService.offerKey(publicId));
        } else {
            const remainingTtl = await this.cache.ttl(AssignmentService.offerKey(publicId));
            await this.cache.set(
                AssignmentService.offerKey(publicId),
                remaining.join(","),
                Math.max(remainingTtl, 1),
            );
        }

        logger.info("assignment.rejected", {publicId, agentId});
    }

    // ── Admin assign ───────────────────────────────────────────────────────

    /**
     * Admin override — bypasses the offer/candidate flow entirely. Force-claims
     * the order for the specified agent regardless of distance or busy state.
     */
    async adminAssign(
        publicId: string,
        agentId: number,
        region: string,
    ): Promise<DeliveryTaskResponseDTO> {
        const ok = await this.cache.trySet(
            AssignmentService.claimKey(publicId),
            String(agentId),
            env.delivery.claimTtlSec,
        );
        if (!ok) throw OrderAlreadyClaimedError;

        const conn = db(region);
        const trx = await conn.transaction();
        let updated: OrderEntity;

        try {
            const claimed = await claimReadyOrderForAgent(publicId, agentId, trx);
            if (!claimed) {
                await this.cache.del(AssignmentService.claimKey(publicId));
                throw OrderNotInReadyStateError;
            }
            updated = claimed;
            await trx.commit();
        } catch (err) {
            await trx.rollback();
            await this.cache.del(AssignmentService.claimKey(publicId));
            throw err;
        }

        await this.presence.markBusy(agentId, region);

        const branch = await getBranch(updated.branchId).catch(() => null);
        const taskDto = DeliveryTaskResponseDTO.from(updated, branch ?? undefined);
        const statusDto = OrderStatusResponseDTO.from(updated);

        this.io.to(`agent:${agentId}`).emit("task.assigned", taskDto);
        this.io.to(`customer:${updated.customerId}`).emit("order.status_changed", statusDto);
        this.io.to(`branch:${updated.branchId}`).emit("order.status_changed", statusDto);

        // Clean up any lingering offer marker.
        await this.cache.del(AssignmentService.offerKey(publicId));

        logger.info("assignment.admin_assigned", {publicId, agentId, region});
        return taskDto;
    }

    // ── Candidate selection ────────────────────────────────────────────────

    /**
     * GEOSEARCH + presence-meta TTL check + busy-set filter.
     * Overscan by 4× to account for stale/busy agents and still return the
     * desired number of fresh, free candidates.
     */
    private async findCandidates(
        region: string,
        lng: number,
        lat: number,
    ): Promise<number[]> {
        const overscan = env.delivery.candidates * 4;
        const raw = await this.cache.geosearchByRadius(
            PresenceService.geoKey(region),
            lng,
            lat,
            env.delivery.radiusMeters,
            overscan,
        );

        const result: number[] = [];
        for (const idStr of raw) {
            const agentId = Number(idStr);
            if (!Number.isFinite(agentId)) continue;
            if (!(await this.cache.exists(PresenceService.metaKey(region, agentId)))) continue;
            if (await this.cache.sismember(PresenceService.busyKey(region), idStr)) continue;
            result.push(agentId);
            if (result.length >= env.delivery.candidates) break;
        }
        return result;
    }
}
