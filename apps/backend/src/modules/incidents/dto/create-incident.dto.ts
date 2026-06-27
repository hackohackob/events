import { IncidentCategory, IncidentSeverity } from "@events/contracts";
import { IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

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

  /** Reporter (sender) phone — always attached so medics have a callback. */
  @IsOptional()
  @IsString()
  reporterPhone?: string;

  /** True when the report is for the reporter themselves. */
  @IsOptional()
  @IsBoolean()
  forSelf?: boolean;

  /** Patient bib when reporting for someone else (backend resolves their
   *  phone + medical by this). */
  @IsOptional()
  @IsString()
  patientBib?: string;

  /** Patient allergies (reporter's own when forSelf; else resolved by BIB). */
  @IsOptional()
  @IsString()
  allergies?: string;

  /** Patient medications, same resolution as `allergies`. */
  @IsOptional()
  @IsString()
  medications?: string;

  /** Patient blood type, same resolution as `allergies`. */
  @IsOptional()
  @IsString()
  bloodType?: string;

  /** Patient pre-existing conditions, same resolution as `allergies`. */
  @IsOptional()
  @IsString()
  conditions?: string;

  /** Client capture time (ISO8601). */
  @IsOptional()
  @IsString()
  timestamp?: string;
}
