import {Request, Response, NextFunction} from "express";
import {NotAuthenticated} from "./errors";
import {container} from "../di/container";
import {TOKENS} from "../di/tokens";
import {PermissionCacheService} from "../rbac/permission.cache.service";

// Role constants kept minimal here; the permission lookup is wired later via a
// cached projection from core-service (Phase 1+ handler).
const SYSTEM_ADMIN = "system_admin";
const RESTAURANT_USER = "restaurant_user";
const DELIVERY_AGENT = "delivery_agent";


export function requireAgent(req: Request, res: Response, next: NextFunction) {
    if (!req.user) return res.status(401).json({error: "User not authenticated"});
    if (req.user.role !== DELIVERY_AGENT) return res.status(403).json({error: "Agent role required"});
    next();
}
export interface RBACOptions {
    resource: string;
    action: string;
    allowSystemAdmin?: boolean; // default true
}

/**
 * Middleware: resolves permissions from a read-through cache populated from core-service.
 */
export function rbac(options: RBACOptions) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.user) throw NotAuthenticated;
            const {allowSystemAdmin = true, resource, action} = options;
            
            if (allowSystemAdmin && req.user.role === SYSTEM_ADMIN) return next();
            
            if (req.user.role === RESTAURANT_USER) {
                const permissionService = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);
                const permissionRole = req.user.restaurantRole ?? req.user.role;
                const permissions = await permissionService.getPermissions(permissionRole);
                
                if (permissionService.hasPermission(permissions, resource, action)) {
                    return next();
                }
            }
            
            return res.status(403).json({error: "Permission denied"});
        } catch (err) {
            next(err);
        }
    };
}

export function requireRestaurantMember(paramName: string = "restaurantId") {
    return (req: Request, res: Response, next: NextFunction) => {
        const restaurantId = Number(req.params[paramName]);
        if (!restaurantId) return res.status(400).json({error: `missing ${paramName}`});
        if (req.user?.role === SYSTEM_ADMIN) return next();
        if (Number(req.user?.restaurantId) !== restaurantId) {
            return res.status(403).json({error: "Permission denied"});
        }
        next();
    };
}

export function requireBranchAccess(paramName: string = "branchId") {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.user?.role === SYSTEM_ADMIN) return next();
        if (req.user?.restaurantRole === "owner") return next();

        const branchId =
            Number(req.params[paramName]) || Number(req.query[paramName]);
        if (!branchId) return next(); // endpoint doesn't scope to a specific branch

        const userBranchIds = req.user?.branchIds ?? [];
        if (!userBranchIds.includes(branchId)) {
            return res.status(403).json({error: "You do not have access to this branch"});
        }
        next();
    };
}
