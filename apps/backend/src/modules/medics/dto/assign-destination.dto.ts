import { AssignMedicDestinationRequest, MedicDestination } from "@events/contracts";
import { IsLatitude, IsLongitude, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class DestinationDto implements MedicDestination {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsString()
  @IsNotEmpty()
  label!: string;
}

export class AssignDestinationDto implements AssignMedicDestinationRequest {
  @IsOptional()
  @ValidateNested()
  @Type(() => DestinationDto)
  destination!: MedicDestination | null;
}
