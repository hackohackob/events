import { IncidentSeverity } from "@events/contracts";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class CreateIncidentDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  severity?: IncidentSeverity;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}
