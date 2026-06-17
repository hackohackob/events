import { IncidentCategory } from "@events/contracts";
import { IsOptional, IsString } from "class-validator";

export class GuidanceDto {
  @IsString()
  transcript!: string;

  @IsOptional()
  @IsString()
  category?: IncidentCategory;
}
