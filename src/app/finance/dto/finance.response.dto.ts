import {RestaurantBalanceEntity} from "../entity/restaurant-balance.entity";

export class RestaurantBalanceResponseDTO {
    restaurantId!: number;
    balances!: Array<{currency: string; balance: number}>;
    asOf!: string;

    static from(restaurantId:number, rows: RestaurantBalanceEntity[]): RestaurantBalanceResponseDTO {
        const dto = new RestaurantBalanceResponseDTO();
        dto.restaurantId = restaurantId;
        dto.balances = rows.map((r) => ({
            currency: r.currency,
            balance: r.balance,
        }));
        dto.asOf = new Date().toISOString();
        return dto;
    }
}

export class PayoutResponseDTO {
    id!: number;
    amount!: number;
    currency!: string;
    status!: string;
    providerReferenceId?: string;
    createdAt!: string;

    static fromTransaction(tx: {
        id: number;
        amount: number;
        currency: string;
        status: string;
        providerReferenceId: string | null;
        createdAt: Date;
    }): PayoutResponseDTO {
        const dto = new PayoutResponseDTO();
        dto.id = tx.id;
        dto.amount = tx.amount;
        dto.currency = tx.currency;
        dto.status = tx.status;
        dto.providerReferenceId = tx.providerReferenceId ?? undefined;
        dto.createdAt = tx.createdAt.toISOString();
        return dto;
    }

    static fromRow(row: Record<string, unknown>): PayoutResponseDTO {
        return PayoutResponseDTO.fromTransaction({
            id: Number(row.id),
            amount: Number(row.amount),
            currency: String(row.currency),
            status: String(row.status),
            providerReferenceId: row.provider_reference_id
                ? String(row.provider_reference_id)
                : null,
            createdAt: new Date(row.created_at as string),
        });
    }
}
