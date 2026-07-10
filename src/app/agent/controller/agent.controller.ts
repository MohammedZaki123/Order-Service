import {NextFunction, Request, Response} from "express";
import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {PresenceService} from "../service/presence.service";
import {AgentService} from "../service/agent.service";
import {EarningService} from "../service/earning.service";
import {DeliveryLifecycleService} from "../service/delivery-lifecycle.service";
import {AssignmentService} from "../../assignment/service/assignment.service";
import {validateBody} from "../../../lib/validation/validate";
import {sendSuccess} from "../../../lib/http/response";
import {AppError} from "../../../lib/error/AppError";
import {
    PresenceOnlineRequestDTO,
    UpdateDeliveryStatusRequestDTO,
} from "../dto/agent.request.dto";
import {OrderStatus} from "../../order/enums";
import {AgentInActiveDeliveryError} from "../errors";
import { RegionNotResolvedError } from "../../../lib/sharding/errors";

@injectable()
export class AgentController {
    constructor(
        @inject(TOKENS.PresenceService) private readonly presenceService: PresenceService,
        @inject(TOKENS.AgentService) private readonly agentService: AgentService,
        @inject(TOKENS.EarningService) private readonly earningService: EarningService,
        @inject(TOKENS.DeliveryLifecycleService)
        private readonly deliveryLifecycleService: DeliveryLifecycleService,
        @inject(TOKENS.AssignmentService) private readonly assignmentService: AssignmentService
    ) {}


    goOnline = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const dto = await validateBody(PresenceOnlineRequestDTO, req.body);
            await this.presenceService.goOnline(Number(req.user?.userId!), req.region!, dto.lat, dto.lng);
            sendSuccess(res, {ok: true});
        } catch (err) {
            next(err);
        }
    };
    goOffline = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const region = req.region!;
            await this.presenceService.goOffline(Number(req.user?.userId!), region);
            sendSuccess(res, {ok: true});
        } catch (err) {
            next(err);
        }
    };

    // ping = async (req: Request, res: Response, next: NextFunction) => {
    //     try {
    //         const dto = await validateBody(PresenceOnlineRequestDTO, req.body);
    //         const region = req.region!;
    //         await this.presenceService.ping(Number(req.user?.userId!), region, dto.lat, dto.lng);
    //         await this.deliveryLifecycleService.emitPositionForActiveTask(
    //             Number(req.user?.userId!),
    //             region,
    //             dto.lat,
    //             dto.lng
    //         );
    //         sendSuccess(res, {ok: true});
    //     } catch (err) {
    //         next(err);
    //     }
    // };

    listTasks = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const status = req.query.status as OrderStatus | undefined;
            const tasks = await this.agentService.listTasks(Number(req.user?.userId!), req.region!, status);
            sendSuccess(res, tasks);
        } catch (err) {
            next(err);
        }
    };

    updateDeliveryStatus = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const dto = await validateBody(UpdateDeliveryStatusRequestDTO, req.body);
            const updated = await this.deliveryLifecycleService.updateStatus(
                req.params.publicId as string,
                Number(req.user?.userId!),
                req.region!,
                dto.status
            );
            sendSuccess(res, {
                orderPublicId: updated.publicId,
                status: updated.status,
                updatedAt: new Date().toISOString(),
            });
        } catch (err) {
            next(err);
        }
    };

    updatePosition = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const dto = await validateBody(PresenceOnlineRequestDTO, req.body);
            await this.deliveryLifecycleService.updatePosition(
                req.params.orderId as string,
                Number(req.user?.userId!),
                req.region!,
                dto.lat,
                dto.lng
            );
            sendSuccess(res, {ok: true});
        } catch (err) {
            next(err);
        }
    };

    getEarnings = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const now = new Date();
            const from = req.query.from
                ? new Date(req.query.from as string)
                : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
            const to = req.query.to ? new Date(req.query.to as string) : now;
            // const limit = Number(req.query.limit) || 50;
            // const cursor = req.query.cursor as string | undefined;

            const result = await this.earningService.getEarnings(
                Number(req.user?.userId!),
                req.region!,
                from,
                to
            );
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }                             
    };

    acceptOrder = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const orderPublicId = req.params.publicId as string;
            const region = req.region!;
            const order = await this.agentService.accept(orderPublicId, Number(req.user?.userId!), region);
            sendSuccess(res, {ok: true, order});
        } catch (err) {
            next(err);
        }
    };

    rejectOrder = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if(req.region==="all") throw RegionNotResolvedError;
            const orderPublicId = req.params.publicId as string;
            const region = req.region!;
            await this.assignmentService.reject(orderPublicId, Number(req.user?.userId!));
            sendSuccess(res, {ok: true});
        } catch (err) {
            next(err);
        }
    };
}
