import { coreClient } from "./core-client";
import {CoreEnvelope, RolePermissionsResponse} from "./types";



export async function getRolePermissions(role: string, correlationId?: string) {
    const res = await coreClient.request<CoreEnvelope<RolePermissionsResponse>>({
        method: "GET",
        path: `/api/internal/rbac/permissions?role=${role}`,
        correlationId,
    });

    return res.data?.permissions ?? [];
}