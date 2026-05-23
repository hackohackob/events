import { Type } from "class-transformer";
import {
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from "class-validator";

export class CreateEventDisciplineDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsNumber()
  distanceKm!: number;

  @IsNumber()
  ascentMeters!: number;

  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsOptional()
  gpxFile?: string;

  @IsString()
  @IsOptional()
  gpxUrl?: string;

  @IsString()
  @IsOptional()
  trackId?: string;
}

export class CreateEventDayDto {
  @IsString()
  @IsISO8601()
  date!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventDisciplineDto)
  disciplines!: CreateEventDisciplineDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventPoiDto)
  pois!: CreateEventPoiDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventAssignmentDto)
  assignments!: CreateEventAssignmentDto[];
}

export class CreateEventPoiDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsNumber()
  lng!: number;

  @IsNumber()
  lat!: number;

  @IsString()
  @IsOptional()
  name?: string;
}

export class CreateEventLocationDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  lng!: number;

  @IsNumber()
  lat!: number;
}

export class CreateEventAssignmentDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsOptional()
  position?: string;

  @IsString()
  @IsOptional()
  vehicle?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateEventDto {
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/i, {
    message: "id must be 3-64 characters and contain only letters, numbers, underscores, or hyphens",
  })
  id?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsArray()
  @IsISO8601({}, { each: true })
  dates!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateEventLocationDto)
  location?: CreateEventLocationDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventDayDto)
  days!: CreateEventDayDto[];
}
