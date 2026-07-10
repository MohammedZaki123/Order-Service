import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {ICacheProvider} from "../../../pkg/cache/cache.interface";
import {RedisCacheProvider} from "../../../pkg/cache/redis";
import {logger} from "../../../lib/logger/logger";
import {NotOnlineError, AgentInActiveDeliveryError} from "../errors";
import {env} from "../../../lib/config/env";
import * as orderRepo from "../../order/repository/order.repo";
import {OrderStatus} from "../../order/enums";
import {db} from "../../../lib/knex/knex";

const PRESENCE_TTL_SEC = 5 * 60;
const GEO_KEY = (region: string) => `presence:geo:${region}`;
const META_KEY = (region: string, agentId: number | string) => `presence:meta:${region}:${agentId}`;
const BUSY_KEY = (region: string) => `presence:busy:${region}`;

// export interface AgentMeta {
//     lat: string;
//     lng: string;
//     updatedAt: string;
// }

@injectable()
export class PresenceService {
    constructor(@inject(TOKENS.CacheProvider) private readonly cacheProvider: ICacheProvider) {}

    static geoKey(region: string): string {
        return `presence:geo:${region}`;
    }

    static metaKey(region: string, agentId: number | string): string {
        return `presence:meta:${region}:${agentId}`;
    }

    static busyKey(region: string): string {
        return `presence:busy:${region}`;
    }

    async goOnline(agentId: number, region: string, lat: number, lng: number): Promise<void> {
        // await Promise.all([
        //     this.cacheProvider.geoadd(GEO_KEY(region), lng, lat, String(agentId)),
        //     this.cacheProvider.set(META_KEY(region, agentId), JSON.stringify(meta), PRESENCE_TTL_SEC),
        //     this.cacheProvider.srem(BUSY_KEY(region), String(agentId)),
        // ]);
        const ttl = env.delivery.presenceStaleSec;
        await this.cacheProvider.hsetWithTtl(
            META_KEY(region, agentId),
            {lat: String(lat), lng: String(lng), updatedAt: String(Date.now())},
            ttl,
        );
        await this.cacheProvider.geoadd(GEO_KEY(region), lng, lat, String(agentId));
    }

    async goOffline(agentId: number, region: string): Promise<void> {
        const conn = db(region);
        const active = await orderRepo.findOrdersByDeliveryAgent(
            agentId,
            [OrderStatus.PICKED],
            1,
            conn
        );
       if(active) throw AgentInActiveDeliveryError;
        await conn("orders")
            .where({delivery_agent_id: agentId, status: OrderStatus.ASSIGNED})
            .update({delivery_agent_id: null, status: OrderStatus.READY, assigned_at: null, updated_at: conn.fn.now()});

       await Promise.all([
        this.cacheProvider.zrem(GEO_KEY(region), String(agentId)),
        this.cacheProvider.del(META_KEY(region, agentId)),
        this.cacheProvider.srem(BUSY_KEY(region), String(agentId)),
        ]);
    }

    // async ping(agentId: number, region: string, lat: number, lng: number): Promise<void> {
    //     const meta = await this.getMeta(agentId, region);
    //     if (!meta) {
    //         throw NotOnlineError;
    //     }
    //     // const updated: AgentMeta = {lat, lng, updatedAt: Date.now()};
    //     await Promise.all([
    //         this.cacheProvider.geoadd(GEO_KEY(region), lng, lat, String(agentId)),
    //         this.cacheProvider.set(META_KEY(region, agentId), JSON.stringify(updated), PRESENCE_TTL_SEC),
    //     ]);
    // }

    // async isOnline(agentId: number, region: string): Promise<boolean> {
    //     return (await this.getMeta(agentId, region)) !== null;
    // }

    async isBusy(agentId: number, region: string): Promise<boolean> {
        return this.cacheProvider.sismember(BUSY_KEY(region), String(agentId));
    }

    async markBusy(agentId: number, region: string): Promise<void> {
        await this.cacheProvider.sadd(BUSY_KEY(region), String(agentId));
    }

    async markFree(agentId: number, region: string): Promise<void> {
        await this.cacheProvider.srem(BUSY_KEY(region), String(agentId));
    }

    // async findNearbyAgents(
    //     region: string,
    //     lng: number,
    //     lat: number,
    //     radiusMeters: number,
    //     maxResults: number = 5
    // ): Promise<number[]> {
    //     const raw = await this.cacheProvider.geosearchByRadius(
    //         GEO_KEY(region),
    //         lng,
    //         lat,
    //         radiusMeters,
    //         maxResults * 3
    //     );
    //
    //     const eligible: number[] = [];
    //     const staleToRemove: string[] = [];
    //     const staleMs = env.delivery.presenceStaleSec * 1000;
    //
    //     for (const agentIdStr of raw) {
    //         const agentId = Number(agentIdStr);
    //         const meta = await this.getMeta(agentId, region);
    //         if (!meta || Date.now() - meta.updatedAt > staleMs) {
    //             staleToRemove.push(agentIdStr);
    //             continue;
    //         }
    //         if (!(await this.isBusy(agentId, region))) {
    //             eligible.push(agentId);
    //             if (eligible.length >= maxResults) break;
    //         }
    //     }
    //
    //     if (staleToRemove.length) {
    //         Promise.all(staleToRemove.map(agentIdStr => this.cacheProvider.zrem(GEO_KEY(region), agentIdStr)))
    //             .catch((e: Error) =>
    //                 logger.warn("Failed to remove stale presence entries", {error: e.message})
    //             );
    //     }
    //
    //     return eligible;
    // }
    //
    // async getMeta(agentId: number, region: string): Promise<AgentMeta | null> {
    //     const raw = await this.cacheProvider.get(META_KEY(region, agentId));
    //     if (!raw) return null;
    //     return JSON.parse(raw) as AgentMeta;
    // }
}
