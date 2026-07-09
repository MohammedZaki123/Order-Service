import {injectable} from "tsyringe";
import {OrderStatus, StatusActor} from "../enums";
import {AppError} from "../../../lib/error/AppError";
import {ActorContext, AssertTransitionContext} from "../types";
import {CancellationWindowExpiredError, invalidStatusTransitionError, ReasonRequiredError} from "../errors";

interface TransitionRule {
    actors: StatusActor[];
    stamp: string | null;
    requiresReason?: boolean;
}

const TRANSITIONS: Record<string, Record<string, TransitionRule>> = {
    [OrderStatus.PENDING_PAYMENT]: {
        [OrderStatus.PLACED]:    {actors: [StatusActor.SYSTEM], stamp: null},
        [OrderStatus.CANCELLED]: {actors: [StatusActor.CUSTOMER, StatusActor.SYSTEM], stamp: "cancelled_at"},
    },
    [OrderStatus.PLACED]: {
        [OrderStatus.ACCEPTED]:  {actors: [StatusActor.RESTAURANT_MEMBER], stamp: "accepted_at"},
        [OrderStatus.REJECTED]:  {actors: [StatusActor.RESTAURANT_MEMBER], stamp: "rejected_at", requiresReason: true},
        [OrderStatus.CANCELLED]: {actors: [StatusActor.CUSTOMER, StatusActor.RESTAURANT_MEMBER, StatusActor.SYSTEM, StatusActor.ADMIN], stamp: "cancelled_at", requiresReason: true},
    },
    [OrderStatus.ACCEPTED]: {
        [OrderStatus.PREPARING]: {actors: [StatusActor.RESTAURANT_MEMBER], stamp: null},
        [OrderStatus.CANCELLED]: {actors: [StatusActor.RESTAURANT_MEMBER, StatusActor.ADMIN], stamp: "cancelled_at", requiresReason: true},
    },
    [OrderStatus.PREPARING]: {
        [OrderStatus.READY]:     {actors: [StatusActor.RESTAURANT_MEMBER], stamp: "ready_at"},
        [OrderStatus.CANCELLED]: {actors: [StatusActor.RESTAURANT_MEMBER, StatusActor.ADMIN], stamp: "cancelled_at", requiresReason: true},
    },
    [OrderStatus.READY]: {
        [OrderStatus.ASSIGNED]:  {actors: [StatusActor.SYSTEM], stamp: "assigned_at"},
        [OrderStatus.CANCELLED]: {actors: [StatusActor.RESTAURANT_MEMBER, StatusActor.ADMIN], stamp: "cancelled_at", requiresReason: true},
    },
    [OrderStatus.ASSIGNED]: {
        [OrderStatus.PICKED]:    {actors: [StatusActor.AGENT], stamp: "picked_at"},
        [OrderStatus.CANCELLED]: {actors: [StatusActor.ADMIN], stamp: "cancelled_at", requiresReason: true},
    },
    [OrderStatus.PICKED]: {
        [OrderStatus.DELIVERED]: {actors: [StatusActor.AGENT], stamp: "delivered_at"},
    },
};

const CUSTOMER_CANCEL_WINDOW_MS = 60 * 1000;

@injectable()
export class OrderStatusService {
    assertTransition(current: OrderStatus, next: OrderStatus, ctx: AssertTransitionContext ): {stamp: string | null} {
        // const allowed: Record<OrderStatus, OrderStatus[]> = {
        //     [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PLACED, OrderStatus.CANCELLED],
        //     [OrderStatus.PLACED]: [OrderStatus.ACCEPTED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
        //     [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
        //     [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
        //     [OrderStatus.READY]: [OrderStatus.ASSIGNED, OrderStatus.PICKED, OrderStatus.CANCELLED], // ready can be cancelled by rest
        //     [OrderStatus.ASSIGNED]: [OrderStatus.PICKED, OrderStatus.READY, OrderStatus.CANCELLED],
        //     [OrderStatus.PICKED]: [OrderStatus.DELIVERED],
        //     [OrderStatus.DELIVERED]: [],
        //     [OrderStatus.REJECTED]: [],
        //     [OrderStatus.CANCELLED]: [],
        // };

        const allowed = TRANSITIONS[current]?.[next];

        if(!allowed){
            throw invalidStatusTransitionError(current, next);
        }
        if (!allowed.actors.includes(ctx.actor)) {
            throw invalidStatusTransitionError(current, next);
        }
        if (allowed.requiresReason && (!ctx.reason || ctx.reason.trim().length === 0)) {
            throw ReasonRequiredError;
        }
        if (ctx.actor === StatusActor.CUSTOMER && current === OrderStatus.CANCELLED && next === OrderStatus.PLACED) {
            if (ctx.acceptedAt) throw CancellationWindowExpiredError;
            if (ctx.placedAt && Date.now() - ctx.placedAt.getTime() > CUSTOMER_CANCEL_WINDOW_MS) {
                throw CancellationWindowExpiredError;
            }
        }
        return {stamp: allowed.stamp};
    }
}

