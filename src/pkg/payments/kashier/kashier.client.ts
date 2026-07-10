import {injectable} from "tsyringe";
import {
    CreateSessionInput,
    CreateSessionResult,
    IPaymentProvider, KashierCreateSessionRequest, KashierCreateSessionResponse,
    RefundParams,
    RefundResult,
} from "../types";
import {verifyKashierWebhookSignature} from "./kashier.signature";
import {logger} from "../../../lib/logger/logger";
import {AppError} from "../../../lib/error/AppError";
import {retry} from "../../utils/retry";


export interface KashierClientConfig {
    baseUrl: string;
    merchantId: string;
    apiKey: string;
    secretKey: string;
    paymentType: string;
    serverWebhookUrl: string;
    merchantRedirect?: string;
    failureRedirectEnabled?: boolean;
    sessionTimeoutSec: number;
}

@injectable()
export class KashierClient implements IPaymentProvider {    

    constructor(private readonly config: KashierClientConfig) {
    }

    async createSession(params: CreateSessionInput): Promise<CreateSessionResult> {

        // Calculate expireAt based on sessionTimeoutMin
        const expireAtDate = new Date(Date.now() + this.config.sessionTimeoutSec * 1000);
        const expireAtStr = expireAtDate.toISOString();

        const requestBody: KashierCreateSessionRequest = {
            expireAt: expireAtStr,
            paymentType: this.config.paymentType,
            amount: params.amount,
            currency: params.currency,
            order: params.merchantOrderId,
            merchantRedirect: this.config.merchantRedirect,
            type: "one-time",
            allowedMethods: params.allowedMethods ?? "card,wallet",
            merchantId: this.config.merchantId,
            failureRedirect: this.config.failureRedirectEnabled?? false,
            description: params.description,
            customer: {
                reference: params.customerReference,
            },
            interactionSource: "ECOMMERCE",
            enable3DS: true,
            serverWebhook: this.config.serverWebhookUrl,
        };

        console.log("Webhook URL in request body:", requestBody.serverWebhook);

        // For local development and manual testing, if mock or sandbox mode is active, we can return a mock session.
        // if (this.config.apiKey === "default-test-key" || this.config.secretKey === "mock-secret-key" || process.env.NODE_ENV === "test") {
        //     logger.info(`[Kashier Mock] Creating payment session for order ${params.orderPublicId}`);
        //     const mockSessionId = `mock_sess_${Math.random().toString(36).substring(2, 15)}`;
        //     const mockRedirectUrl = `https://payments.kashier.io/session/${mockSessionId}?mode=test`;
        //     return {
        //         sessionId: mockSessionId,
        //         redirectUrl: mockRedirectUrl,
        //         rawResponse: { status: "CREATED", _id: mockSessionId, sessionUrl: mockRedirectUrl },
        //     };
        // }

            const response = await retry(
                async () => {
                    logger.info(`[Kashier API] Creating session at ${this.config.baseUrl}/v3/payment/sessions`);
                    const response = await fetch(`${this.config.baseUrl}/v3/payment/sessions`, {
                        method: "POST", 
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": this.config.secretKey,
                            "api-key": this.config.apiKey,
                        },
                        body: JSON.stringify(requestBody),
                    });

                    if (response.status >= 500) {
                        throw new Error(`kashier ${response.status}: ${await response.text().catch(() => "")}`);
                    }
                    if (!response.ok) {
                        // Non-retryable upstream error (4xx) — surface verbatim.
                        const text = await response.text().catch(() => "");
                        const err = new Error(`kashier ${response.status}: ${text}`);
                        (err as any).statusCode = response.status;
                        (err as any).retryable = false;
                        throw err;
                    }

                    return (await response.json()) as KashierCreateSessionResponse;
                },
                {
                    attempts: 3,
                    initialDelayMs: 200,
                    maxDelayMs: 1500,
                    isRetryable: (err) => (err as any)?.retryable !== false,
                }
            );

        if (!response?._id || !response?.sessionUrl) {
            throw new Error(`kashier: malformed session response: ${JSON.stringify(response)}`);
        }

        return {
            providerSessionId: response._id,
            redirectUrl: response.sessionUrl,
            rawResponse: response,
            expiresAt: response.expireAt ?? expireAtStr,
        };

    }

    async refund(params: RefundParams): Promise<RefundResult> {
        const amountDecimal = (params.amount / 100).toFixed(2);

        const requestBody = {
            transactionId: params.providerReferenceId,
            amount: amountDecimal,
            currency: params.currency,
            reason: "Merchant Refund",
        };

        // For local development and manual testing
        if (this.config.apiKey === "default-test-key" || this.config.secretKey === "mock-secret-key" || process.env.NODE_ENV === "test") {
            logger.info(`[Kashier Mock] Refunding transaction ${params.providerReferenceId}`);
            return {
                success: true,
                providerReferenceId: `ref_tx_${Math.random().toString(36).substring(2, 10)}`,
                rawResponse: { message: "success", status: "SUCCESS" },
            };
        }

        try {
            return await retry(
                async () => {
                    logger.info(`[Kashier API] Processing refund at ${this.config.baseUrl}/api/refund`);
                    const response = await fetch(`${this.config.baseUrl}/api/refund`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": this.config.secretKey,
                        },
                        body: JSON.stringify(requestBody),
                    });

                    if (response.status >= 500) {
                        throw new AppError(`Kashier refund failed: ${response.status}`, response.status);
                    }
                    if (!response.ok) {
                        const errText = await response.text();
                        logger.error(`[Kashier Error] Failed to process refund: ${response.status} - ${errText}`);
                        throw new AppError(`Kashier refund failed: ${response.status} ${errText}`, response.status);
                    }

                    const data = await response.json() as any;
                    return {
                        success: data.message === "success" || data.status === "SUCCESS",
                        providerReferenceId: data.transactionId || "",
                        rawResponse: data,
                    };
                },
                {
                    attempts: 3,
                    initialDelayMs: 50,
                    maxDelayMs: 500,
                    isRetryable: (err) => !(err instanceof AppError) || err.statusCode >= 500,
                }
            );
        } catch (error) {
            logger.error(`[Kashier API Exception] refund error:`, error as any);
            return {
                success: false,
                providerReferenceId: "",
                rawResponse: error instanceof Error ? error.message : String(error),
            };
        }
    }

    verifyWebhook(payload: Record<string, unknown>, signature: string, signatureKeys: string[]): boolean {
        // // If we are using mock mode and signature is "mock-signature", allow it
        // if ((this.config.apiKey === "default-test-key" || this.config.secretKey === "mock-secret-key" || process.env.NODE_ENV === "test") && signature === "mock-signature") {
        //     return true;
        // }
        return verifyKashierWebhookSignature(payload, signature, signatureKeys,this.config.apiKey);
    }
}
