import {inject, injectable} from "tsyringe";
import {NextFunction, Request, Response} from "express";
import {TOKENS} from "../../../lib/di/tokens";
import {PaymentService} from "../service/payment.service";
import {PaymentWebhookService} from "../service/webhook.service";
import {validateBody} from "../../../lib/validation/validate";
import {InitPaymentRequestDTO, RefundRequestDTO} from "../dto/payment.dto";
import {sendSuccess} from "../../../lib/http/response";
import {AppError} from "../../../lib/error/AppError";
import {logger} from "../../../lib/logger/logger";
import { KashierWebhookEnvelope } from "../../../pkg/payments/types";
import {MalformedWebhookError} from "../errors";
//
// function parseKashierWebhook(req: Request): KashierWebhookEnvelope {
//     const rawBody = (req as any).rawBody;
//     if (!rawBody) {
//         return req.body;
//     }
//     const parsed = JSON.parse(rawBody.toString("utf8"));
//     return parsed as KashierWebhookEnvelope;
// }

@injectable()
export class PaymentController {
    constructor(
        @inject(TOKENS.PaymentService) private readonly paymentService: PaymentService,
        @inject(TOKENS.PaymentWebhookService) private readonly webhookService: PaymentWebhookService
    ) {}


    getPaymentDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const region = req.region as string;
            const paymentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
            if (!paymentId) throw new AppError("Payment ID is required", 400);

            const result = await this.paymentService.getPaymentDetails(paymentId, region);
            sendSuccess(res, result, 200);
        } catch (error) {
            next(error);
        }
    };

    handleKashierWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            if(!req.rawBody) {
                throw MalformedWebhookError;
            }
            // Kashier puts webhook signature in "signature" query param or "x-kashier-signature" / "signature" header
            const signatureRaw = req.headers["x-kashier-signature"];
            const signature = (Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw) as string;
            
            if (!signature) {
                logger.warn("[PaymentWebhook] Webhook received without signature header or query parameter.");
                throw new AppError("Missing signature authentication", 400);
            }
            await this.webhookService.verifyAndProcessWebhook(req.rawBody, signature, req.region!);

            res.status(200).json({success: true});
        } catch (error) {
            next(error);
        }
    };
    //
    // kashier = async (req: Request, res: Response, next: NextFunction) => {
    //     try {
    //         if (!req.rawBody) throw MalformedWebhookError;
    //
    //         const sigHeader = req.headers["x-kashier-signature"];
    //         const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    //
    //         await this.kashierWebhook.processKashierWebhook(req.rawBody, signature, req.region!);
    //         // Per Kashier docs: any 200 acknowledges receipt. We always 200 on
    //         // successful (or duplicate) processing.
    //         res.status(200).json({success: true});
    //     } catch (err) {
    //         next(err);
    //     }
    // };

    refundPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const region = req.region!;
            const transactionId = req.params.id as string;
            if (!transactionId) {
                throw new AppError("Transaction ID is required", 400);
            }
            const validated = await validateBody(RefundRequestDTO, req.body);

            const result = await this.paymentService.refundPayment(
                transactionId,
                validated.amount,
                region
            );

            sendSuccess(res, result, 200);
        } catch (error) {
            next(error);
        }
    };


    getById = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const restaurantId = Number(req.params.restaurantId);
            const paymentId = Number(req.params.paymentId);
            if (!Number.isFinite(paymentId) || paymentId <= 0) {
                return res.status(400).json({error: "invalid paymentId"});
            }
            const result = await this.paymentService.getById(paymentId, restaurantId, req.region!);
            sendSuccess(res, result);
        } catch (err) {
            next(err);
        }
    };
}
