import {NextFunction, Request, Response} from "express";
import {inject, injectable} from "tsyringe";
import {TOKENS} from "../../../lib/di/tokens";
import {FinanceService} from "../service/finance.service";
import {validateBody} from "../../../lib/validation/validate";
import {sendSuccess} from "../../../lib/http/response";
import {CreatePayoutRequestDTO} from "../dto/finance.request.dto";
import {AppError} from "../../../lib/error/AppError";
import {RegionNotResolvedError} from "../../../lib/sharding/errors";

@injectable()
export class FinanceController {
    constructor(@inject(TOKENS.FinanceService) private readonly financeService: FinanceService) {}

    getBalance = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (req.region === "all") throw RegionNotResolvedError;
            const restaurantId = Number(req.params.restaurantId);
            const balance = await this.financeService.getBalance(restaurantId, req.region!);
            sendSuccess(res, balance);
        } catch (err) {
            next(err);
        }
    };

    listPayouts = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (req.region === "all") throw RegionNotResolvedError;
            const restaurantId = Number(req.params.restaurantId);
            const from = req.query.from
                ? new Date(req.query.from as string)
                : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
            const to = req.query.to ? new Date(req.query.to as string) : new Date();
            // const limit = Number(req.query.limit) || 50;
            // const cursor = req.query.cursor as string | undefined;

            const payouts = await this.financeService.listPayouts(
                restaurantId,
                req.region!,
                from,
                to,
            );
            sendSuccess(res, payouts);
        } catch (err) {
            next(err);
        }
    };

    recordPayout = async (req: Request, res: Response, next: NextFunction) => {
        try {
            // if (req.user?.role !== "system_admin") {
            //     throw new AppError("Only system administrators may record payouts", 403);
            // }
            const restaurantId = Number(req.params.restaurantId);
            const dto = await validateBody(CreatePayoutRequestDTO, {...req.body, restaurantId});
            const idempotencyKey = req.headers["idempotency-key"] as string;
            if (!idempotencyKey) {
                throw new AppError("Idempotency-Key header is required", 400);
            }

            const payout = await this.financeService.recordPayout({
                restaurantId,
                amount: dto.amount,
                currency: dto.currency,
                region: req.region!,
                providerReferenceId: dto.providerReferenceId,
                idempotencyKey,
                note: dto.note,
            });
            sendSuccess(res, payout, 201);
        } catch (err) {
            next(err);
        }
    };
}
