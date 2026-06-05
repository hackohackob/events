import { LocationUpdate } from "@events/contracts";
import { IsISO8601, IsNumber, IsOptional, IsString } from "class-validator";

export class LocationUpdateDto implements LocationUpdate {
  @IsString()
  eventId!: string;

  @IsString()
  userId!: string;

  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  battery?: number;

  @IsISO8601()
  timestamp!: string;
}
