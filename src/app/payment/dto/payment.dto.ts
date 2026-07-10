import { IsNotEmpty, IsString, IsNumber, IsOptional, Min } from "class-validator";
import {
    PAYMENT_PROVIDER_IDS,
    PaymentProviderName,
    TransactionMethod,
    TransactionStatus,
    TransactionType
} from "../enums";
import {TransactionEntity} from "../entity/transaction.entity";
import {PaymentSessionEntity} from "../entity/payment-session.entity";

export class InitPaymentRequestDTO {
    @IsNotEmpty()
    @IsString()
    orderPublicId!: string;
}

export class RefundRequestDTO {
    @IsNotEmpty()
    @IsNumber()
    @Min(1)
    amount!: number; // minor units
}

export class PaymentInitResponseDTO {
    sessionId!: string;
    providerSessionId!: string;
    redirectUrl!: string;
    amount!: number;
    currency!: string;
    expiresAt!: string;

    static from(session: PaymentSessionEntity , expiresAt: string): PaymentInitResponseDTO {
        const dto = new PaymentInitResponseDTO();
        dto.sessionId = String(session.id);
        dto.providerSessionId = session.providerSessionId;
        dto.redirectUrl = session.redirectUrl;
        dto.amount = session.amount;
        dto.currency = session.currency;
        dto.expiresAt = expiresAt;
        return dto;
    }
}


const PROVIDER_NAME_BY_ID = new Map<number, PaymentProviderName>([
    [PAYMENT_PROVIDER_IDS[PaymentProviderName.KASHIER], PaymentProviderName.KASHIER],
]);

export class PaymentResponseDTO {
    id!: number;
    orderId!: number | null;
    type!: TransactionType;
    method!: TransactionMethod;
    provider!: PaymentProviderName | null;
    providerReferenceId!: string | null;
    status!: TransactionStatus;
    amount!: number;
    currency!: string;
    isRefunded!: boolean;
    refundedPaymentId!: number | null;
    createdAt!: string;
    updatedAt!: string;

    static from(tx: TransactionEntity): PaymentResponseDTO {
        const dto = new PaymentResponseDTO();
        dto.id = tx.id;
        dto.orderId = tx.orderId;
        dto.type = tx.transactionType;
        dto.method = tx.method;
        dto.provider = tx.providerId !== null ? PROVIDER_NAME_BY_ID.get(tx.providerId) ?? null : null;
        dto.providerReferenceId = tx.providerReferenceId;
        dto.status = tx.status;
        dto.amount = tx.amount;
        dto.currency = tx.currency;
        dto.isRefunded = tx.isRefunded;
        dto.refundedPaymentId = tx.refundedPaymentId;
        dto.createdAt = tx.createdAt.toISOString();
        dto.updatedAt = tx.updatedAt.toISOString();
        return dto;
    }
}

