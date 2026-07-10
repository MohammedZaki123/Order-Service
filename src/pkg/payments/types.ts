export interface CreateSessionInput {
    merchantOrderId: string;
    amount: string; // in minor units
    currency: string;
    customerReference: string;
    description?: string;
    allowedMethods?: string;
}

export interface CreateSessionResult {
    providerSessionId: string;
    redirectUrl: string;
    rawResponse: unknown;
    expiresAt?: string | undefined;
}

export interface RefundParams {
    providerReferenceId: string; // The transaction ID from Kashier to refund
    amount: number; // in minor units
    currency: string;
}

export interface RefundResult {
    success: boolean;
    providerReferenceId: string;
    rawResponse: any;
}

export interface IPaymentProvider {
    createSession(params: CreateSessionInput): Promise<CreateSessionResult>;
    refund(params: RefundParams): Promise<RefundResult>;
    // signatureKeys is now optional — providers should accept an explicit parameter
    verifyWebhook(payload: Record<string, unknown>, signature: string, signatureKeys?: string[]): boolean;
}

export interface KashierWebhookEnvelope {
    event: "pay" | "refund" | "authorize" | "void" | "capture";
    data: KashierWebhookData;
}

export interface KashierWebhookData {
  amount: number;
  currency: string;
  kashierOrderId: string;
  orderReference?: string;
  status?: "SUCCESS" | "FAILED" ;
  transactionId: string;
  merchantOrderId: string;
  method?: string;
  signatureKeys?: string[];
  [k : string] : unknown;
}


export interface KashierCreateSessionRequest  {
    merchantId: string;
    paymentType: string;          // e.g. "credit"
    amount: string;               // major units, "18.40"
    currency: string;             // "EGP"
    order: string;                // merchant order ref (we pass our publicId)
    type: "one-time";
    allowedMethods: string;       // "card,wallet"
    enable3DS: boolean;
    serverWebhook: string;
    merchantRedirect?: string;
    failureRedirect?: boolean;
    description?: string;
    interactionSource?: "ECOMMERCE";
    expireAt?: string;
    customer: {reference: string; email?: string};
}

export interface KashierCreateSessionResponse {
    _id: string;
    status: string;
    sessionUrl: string;
    expireAt?: string;
    paymentParams?: {
        order?: string;
        amount?: string;
        currency?: string;
        hash?: string;
        [k: string]: unknown;
    };
    [k: string]: unknown;
}