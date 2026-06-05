import { IsIn, IsNumber, IsOptional, IsString } from "class-validator";

export class UpdateIncidentDetailsDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  peopleAffected?: number;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsIn(["low", "medium", "high", "critical"])
  severity?: string;

  @IsOptional()
  @IsIn(["open", "assigned", "in_progress", "resolved", "closed", "archived"])
  status?: string;
}
