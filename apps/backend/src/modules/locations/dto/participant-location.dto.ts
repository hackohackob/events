import { ParticipantLocationRequest } from "@events/contracts";
import { IsISO8601, IsNumber, IsOptional } from "class-validator";

export class ParticipantLocationDto implements ParticipantLocationRequest {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsISO8601()
  timestamp!: string;
}
