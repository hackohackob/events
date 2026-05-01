import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class CreateEventDisciplineDto {
  @IsString()
  @IsNotEmpty()
  date!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsNumber()
  distanceKm!: number;

  @IsNumber()
  ascentMeters!: number;

  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsNotEmpty()
  gpxFile!: string;

  @IsString()
  @IsOptional()
  trackId?: string;
}

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsISO8601({}, { each: true })
  dates!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventDisciplineDto)
  disciplines!: CreateEventDisciplineDto[];
}
