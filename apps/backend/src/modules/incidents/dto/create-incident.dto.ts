import { IncidentCategory, IncidentSeverity } from "@events/contracts";
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

  /** Standardised incident category from the runner PWA. */
  @IsOptional()
  @IsString()
  category?: IncidentCategory;

  /** GPS accuracy radius (metres) at capture time. */
  @IsOptional()
  @IsNumber()
  accuracy?: number;

  /** Reporter bib number (runner PWA). */
  @IsOptional()
  @IsString()
  bibNumber?: string;

  /** Reporter display name (runner PWA). */
  @IsOptional()
  @IsString()
  runnerName?: string;

  /** Client capture time (ISO8601). */
  @IsOptional()
  @IsString()
  timestamp?: string;
}
