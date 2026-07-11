import type {Request, Response, NextFunction} from "express";
import {randomUUID} from "node:crypto";

export function correlationId(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers["x-correlationid"] || req.headers["x-correlation-id"];
    const id = typeof incoming === "string" && incoming.length > 0 ? incoming : randomUUID();
    req.correlationId = id;
    res.setHeader("X-CorrelationId", id);
    next();
}
