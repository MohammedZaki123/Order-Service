import {IsEnum, IsNumber, IsOptional, IsString, MaxLength, IsLatitude, IsLongitude} from "class-validator";
import {DeliveryAction} from "../enums";

export class PresenceOnlineRequestDTO {
    @IsLatitude()
    lat!: number;

    @IsLongitude()
    lng!: number;
}

export class UpdateDeliveryStatusRequestDTO {
    @IsEnum(DeliveryAction)
    status!: DeliveryAction;

    // @IsOptional()
    // @IsString()
    // @MaxLength(500)
    // reason?: string;
}
