import { AddMedicRequest, MedicType } from "@events/contracts";
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class AddMedicDto implements AddMedicRequest {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  vehicle?: string;

  @IsOptional()
  @IsIn(["coordinator", "paramedic", "medic"])
  type?: MedicType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
