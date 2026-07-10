/**
 * Register all core-event handlers for the order service.
 * Called at worker boot to set up inbound event listeners.
 */

import {container} from "../../lib/di/container";
import {TOKENS} from "../../lib/di/tokens";
import {registerHandler} from "../../lib/core-events/consumer";
import {PermissionCacheService} from "../../lib/rbac/permission.cache.service";
import {CoreDataCacheService} from "./service/core-data-cache.service";

export function registerOrderModuleCoreEventHandlers(): void {

    const coreData = container.resolve<CoreDataCacheService>(TOKENS.CoreDataCacheService);
    const perms = container.resolve<PermissionCacheService>(TOKENS.PermissionCacheService);

    registerHandler("product.stock.changed",     coreData.handleProductStockChanged);
    registerHandler("product.price.changed",     coreData.handleProductPriceChanged);
    registerHandler("branch.updated",            coreData.handleBranchUpdated);
    registerHandler("branch.deactivated",        coreData.handleBranchDeactivated);
    registerHandler("restaurant.suspended",      coreData.handleRestaurantSuspended);
    registerHandler("rbac.permissions_changed",  perms.handlePermissionsChanged);
}

