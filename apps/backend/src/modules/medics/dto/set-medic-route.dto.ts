import { IsObject, IsOptional, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type { MedicDestination, MedicRoute } from "@events/contracts";

class DestinationDto implements MedicDestination {
  lat!: number;
  lng!: number;
  label!: string;
}

/**
 * Attach or clear a medic's active navigation path. `route` is passed through
 * mostly as-is (it originates from our own routing proxy), so we keep validation
 * light and only structurally guard the destination.
 */
export class SetMedicRouteDto {
  /** The navigation route, or null to clear it. */
  @IsOptional()
  @IsObject()
  route?: MedicRoute | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => DestinationDto)
  destination?: MedicDestination | null;
}
