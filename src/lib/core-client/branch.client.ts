import { coreClient } from "./core-client";
import {CoreBranchProduct, CoreEnvelope, ReserveStockResult, ReserveStockApplied, ReserveStockItem, CoreBranchMetaData} from "./types";
import {ICacheProvider} from "../../pkg/cache/cache.interface";
import {container} from "tsyringe";
import {TOKENS} from "../di/tokens";
import {toSeconds} from "../../pkg/utils/time";
import {logger} from "../logger/logger";

const BRANCH_CACHE_TTL = toSeconds(1, "h");
const PRODUCT_CACHE_TTL = toSeconds(1, "h");

function branchCacheKey(branchId: number): string {
    return `core:branch:${branchId}`;
}

function productCacheKey(branchId: number, productId: number): string {
    return `core:branch:${branchId}:product:${productId}`;
}

function cache(): ICacheProvider {
    return container.resolve<ICacheProvider>(TOKENS.CacheProvider);
}





export async function getBranch(branchId: number, correlationId?: string) {
    const c = cache();
    const cached = await c.get(branchCacheKey(branchId));
    if (cached) {
        // cache hit - return cached value
        try { return JSON.parse(cached) as CoreBranchMetaData; } catch { /* fall through */ }
    }

    // cache miss - fetch from core and cache result
    const res = await coreClient.request<CoreEnvelope<CoreBranchMetaData>>({
            method: "GET",
            path: `/api/internal/branches/${branchId}`,
            correlationId,
        });

    await c.set(branchCacheKey(branchId), JSON.stringify(res.data), BRANCH_CACHE_TTL).catch((err) => {
        logger.warn("getBranch cache set failed", {branchId, error: (err as Error).message});
    });
    return res.data ;
    }


export async function getBranchesByIds(
    branchIds: number[],
    correlationId?: string,
): Promise<Map<number, CoreBranchMetaData>> {
    const result = new Map<number, CoreBranchMetaData>();
    if (branchIds.length === 0) return result;
    const unique = Array.from(new Set(branchIds));
    const c = cache();

    // Cache pass.
    const misses: number[] = [];
    await Promise.all(
        unique.map(async (id) => {
            const raw = await c.get(branchCacheKey(id));
            if (raw) {
                try {
                    result.set(id, JSON.parse(raw) as CoreBranchMetaData);
                    return;
                } catch { /* fall through to network */ }
            }
            misses.push(id);
        }),
    );
    if (misses.length === 0) return result;

    // Network pass — single batch call.
    const ids = misses.join(",");
    const res = await coreClient.request<CoreEnvelope<CoreBranchMetaData[]>>({
        method: "GET",
        path: `/api/internal/branches?ids=${encodeURIComponent(ids)}`,
        correlationId,
    });
    await Promise.all(
        res.data.map(async (b) => {
            result.set(Number(b.id), b);
            await c.set(branchCacheKey(Number(b.id)), JSON.stringify(b), BRANCH_CACHE_TTL).catch(() => {});
        }),
    );
    return result;
}

export async function getBranchProducts(branchId: number, productIds: number[], correlationId?: string)  {
    if (productIds.length === 0) return [];
    const c = cache();
    const unique = Array.from(new Set(productIds));
    const cached: CoreBranchProduct[] = [];
    const misses: number[] = [];

    await Promise.all(
        unique.map(async (pid) => {
            const raw = await c.get(productCacheKey(branchId, pid));
            if (!raw) {
                misses.push(pid);
                return;
            }
            try {
                const parsed = JSON.parse(raw) as Partial<CoreBranchProduct>;
                // Event-driven cache entries are partial — they hold price /
                // stock / isAvailable but no name/imageUrl. Treat as a miss
                // so we fetch the full row from core.
                if (parsed.name === undefined) {
                    misses.push(pid);
                    return;
                }
                cached.push(parsed as CoreBranchProduct);
            } catch {
                misses.push(pid);
            }
        }),
    );
    if (misses.length === 0) return cached;

    const res = await coreClient.request<CoreEnvelope<CoreBranchProduct[]>>({
        method: "GET",
        path: `/api/internal/branches/${branchId}/products?ids=${encodeURIComponent(misses.join(","))}`,
        correlationId,
    });


    // Populate the cache with the full rows we just fetched. Events that
    // arrive later for these products will MERGE on top via core-data-cache.
    await Promise.all(
        res.data.map((p) => c.set(productCacheKey(branchId, Number(p.productId)), JSON.stringify(p), PRODUCT_CACHE_TTL)
                .catch((err) =>
                    logger.warn("getBranchProducts cache set failed", {branchId, productId: p.productId, error: (err as Error).message}),
                ),
        ),
    );

    return [...cached, ...res.data];
}


export async function reserveStock(branchId: number, items: ReserveStockItem[], idempotencyKey?: string, correlationId?: string) {
        return coreClient.request<CoreEnvelope<ReserveStockResult>>({
            method: "POST",
            path: `/api/internal/branches/${branchId}/reserve-stock`,
            body: {items},
            idempotencyKey,
            correlationId,
        });
    }

export async function undoReserveStock(branchId: number, items: ReserveStockItem[], idempotencyKey?: string, correlationId?: string) {
    return coreClient.request<CoreEnvelope<ReserveStockResult>>({
        method: "POST",
        path: `/api/internal/branches/${branchId}/undo-reserve-stock`,
        body: {items},
        idempotencyKey,
        correlationId,
    });
}

// export async function updateBranchStock(branchId: number, items: ReserveStockItem[], idempotencyKey?: string, correlationId?: string) {
//     return coreClient.request<CoreEnvelope<void>>({
//         method: "POST",
//         path: `/api/internal/branches/${branchId}/update-stock`,
//         body: {items},
//         idempotencyKey,
//         correlationId,
//     });
// }
