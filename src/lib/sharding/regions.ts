 import {env} from "../config/env";

const set = new Set(env.regions.map((region: string) => region.toLowerCase()));

export const REGIONS: ReadonlyArray<string> = env.regions;


export function normalizeRegion(candidate: string | null | undefined): string | undefined{
    return typeof candidate === "string"? candidate.toLowerCase(): undefined;
}

export function isRegion(candidate: string | undefined | null): candidate is string {
    const normalized = normalizeRegion(candidate);
    return !!normalized && set.has(normalized);
}



export function assertRegion(candidate: string | undefined | null): string {
    const normalized = normalizeRegion(candidate);
    if (!isRegion(normalized)) {
        throw new Error(`Unknown region: "${candidate}". Known: ${env.regions.join(",")}`);
    }
    return normalized;
}
