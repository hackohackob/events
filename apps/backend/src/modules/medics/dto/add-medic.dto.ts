import { AddMedicRequest } from "@events/contracts";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

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
}
