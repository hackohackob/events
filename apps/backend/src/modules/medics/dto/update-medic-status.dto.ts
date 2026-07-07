import { UpdateMedicStatusRequest } from "@events/contracts";
import { IsIn } from "class-validator";

export class UpdateMedicStatusDto implements UpdateMedicStatusRequest {
  @IsIn(["available", "stationary", "rest", "sweeper"])
  status!: "available" | "stationary" | "rest" | "sweeper";
}
