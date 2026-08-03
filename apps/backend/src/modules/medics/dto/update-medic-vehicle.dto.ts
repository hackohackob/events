import { UpdateMedicVehicleRequest, VEHICLE_TYPES, VehicleType } from "@events/contracts";
import { IsIn } from "class-validator";

export class UpdateMedicVehicleDto implements UpdateMedicVehicleRequest {
  @IsIn(VEHICLE_TYPES)
  vehicleType!: VehicleType;
}
