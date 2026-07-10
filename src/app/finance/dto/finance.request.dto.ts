import {IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength} from "class-validator";

export class CreatePayoutRequestDTO {
    @IsInt()
    @Min(1)
    restaurantId!: number;

    @IsInt()
    @Min(1)
    amount!: number;

    @IsString()
    @MinLength(2)
    @MaxLength(8)
    currency!: "EGP" | "SAR";

    @IsString()
    @MinLength(1)
    @MaxLength(128)
    providerReferenceId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}
