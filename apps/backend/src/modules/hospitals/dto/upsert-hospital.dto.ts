import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { HOSPITAL_CAPABILITIES, HospitalCapability, UpsertHospitalRequest } from "@events/contracts";

export class HospitalHoursRuleDto {
  /** 0=Sunday … 6=Saturday */
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days!: number[];

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "open must be HH:mm" })
  open!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "close must be HH:mm" })
  close!: string;
}

export class UpsertHospitalDto implements UpsertHospitalRequest {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  nameBg?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  phones?: string[];

  @IsOptional()
  @IsBoolean()
  emergency24h?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HospitalHoursRuleDto)
  hours?: HospitalHoursRuleDto[];

  @IsOptional()
  @IsString()
  hoursText?: string;

  @IsOptional()
  @IsArray()
  @IsIn(HOSPITAL_CAPABILITIES, { each: true })
  capabilities?: HospitalCapability[];

  @IsOptional()
  @IsString()
  notes?: string;
}
