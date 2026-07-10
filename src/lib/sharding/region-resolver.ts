import type {Request, Response, NextFunction} from "express";
import {isRegion, normalizeRegion} from "./regions";
import {RegionNotResolvedError} from "./errors";

/**
 * Reads the region from the `X-Region` header only. "all" is preserved for
 * admin fan-out reads; writes must resolve to one concrete region.
 */
export function resolveRegion(req: Request, _res: Response, next: NextFunction) {
    const raw = req.headers["x-region"]; // x-region: eg
    const value = Array.isArray(raw) ? raw[0] : raw;
    const queryValue = typeof req.query.region === "string" ? req.query.region : undefined;
    const normalized = normalizeRegion(value ?? queryValue);
    if (normalized && isRegion(normalized)) {
        req.region = normalized;
    }
    else if(normalized === "all"){
        req.region = "all";
    }
    next();
}

export function requireRegion(req: Request, _res: Response, next: NextFunction) {
    if (!req.region) throw RegionNotResolvedError;
    next();
}

/**
 * Stricter than `requireRegion`: rejects `req.region === "all"` so that
 * single-shard endpoints (writes, lookups by id) never silently fan out.
 */
export function requireConcreteRegion(req: Request, _res: Response, next: NextFunction) {
    if (!req.region || req.region === "all") throw RegionNotResolvedError;
    next();
}
