import { CloseIncidentRequest } from "@events/contracts";
import { IsOptional, IsString } from "class-validator";

export class CloseIncidentDto implements CloseIncidentRequest {
  @IsOptional()
  @IsString()
  vitals?: string;

  @IsOptional()
  @IsString()
  treatment?: string;

  @IsOptional()
  @IsString()
  transport?: string;
}
