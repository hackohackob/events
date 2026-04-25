import { CreateIncidentRequest, IncidentSeverity } from "@events/contracts";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class CreateIncidentDto implements Omit<CreateIncidentRequest, "eventId"> {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsString()
  type!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  severity?: IncidentSeverity;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}
