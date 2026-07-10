import {NextFunction, Request, Response} from "express";
import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {AssignmentService} from "../service/assignment.service";
import {validateBody} from "../../../lib/validation/validate";
import {sendSuccess} from "../../../lib/http/response";
import {AssignDeliveryRequestDTO} from "../dto/assignment.request.dto";
import {RegionNotResolvedError} from "../../../lib/sharding/errors";

@injectable()
export class AssignmentController {
    constructor(
        @inject(TOKENS.AssignmentService) private readonly assignmentService: AssignmentService
    ) {}

    assign = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (req.region === "all") throw RegionNotResolvedError;
            const dto = await validateBody(AssignDeliveryRequestDTO, req.body);
            if (!dto.agentId) {
                return res.status(400).json({error: "agentId is required"});
            }
            const result = await this.assignmentService.adminAssign(
                req.params.publicId as string,
                dto.agentId,
                req.region!
            );
            sendSuccess(res, result, 201);
        } catch (err) {
            next(err);
        }
    };

    // reassign = async (req: Request, res: Response, next: NextFunction) => {
    //     try {
    //         // Re-trigger the worker broadcast for a single order
    //         const {db} = await import("../../../lib/knex/knex");
    //         const {findOrderByPublicId} = await import("../../order/repository/order.repo");
    //         const conn = db(req.region!);
    //         const order = await findOrderByPublicId(req.params.orderId as string, conn);
    //         if (!order) {
    //             throw new (await import("../../../lib/error/AppError")).AppError("Order not found", 404);
    //         }
    //         const result = await this.assignmentService.tryAssign(order, req.region!);
    //         sendSuccess(res, {ok: true, status: result}, 200);
    //     } catch (err) {
    //         next(err);
    //     }
    // };
}
