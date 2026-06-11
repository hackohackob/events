import { UpdateMedicStatusRequest } from "@events/contracts";
import { IsIn } from "class-validator";

export class UpdateMedicStatusDto implements UpdateMedicStatusRequest {
  @IsIn(["available", "stationary", "rest"])
  status!: "available" | "stationary" | "rest";
}
