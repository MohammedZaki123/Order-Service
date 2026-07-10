import { injectable } from "tsyringe";
import { toMs } from "../../pkg/utils/time";
import { getRolePermissions } from "../core-client/rbac.client";
import {logger} from "../logger/logger";


type RbacPermissionsChangedPayload = {role?: string};

@injectable()
export class PermissionCacheService {
    private cache: Map<string, {permissions: string[], cachedAt: number}> = new Map();
    private readonly CACHE_TTL = toMs(1,"h");


    async getPermissions(roleName: string): Promise<string[]>{
        const cached = this.cache.get(roleName);

        if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
            return cached.permissions;
        }
        const permissions = await getRolePermissions(roleName);
        this.cache.set(roleName, { permissions, cachedAt: Date.now() });
        return permissions;
    }
    
     hasPermission (permissions: String[], resource: string, action: string): boolean {
        return permissions.includes(`${resource}:${action}`);
    }

    invalidate(roleName? : string): void{
        if(roleName){
            this.cache.delete(roleName);
        }else{
            this.cache.clear();
        }
    }

    handlePermissionsChanged = async (payload: unknown): Promise<void> => {
        const p = payload as RbacPermissionsChangedPayload | undefined;
        this.invalidate(p?.role);
        logger.info("rbac.permissions_changed -> permission cache cleared", {role: p?.role ?? "*"});
    };
}