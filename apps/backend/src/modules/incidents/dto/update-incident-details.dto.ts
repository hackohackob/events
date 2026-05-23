import { IsNumber, IsOptional, IsString } from "class-validator";

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
}
