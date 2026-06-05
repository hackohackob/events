import { UpdateMedicStatusRequest } from "@events/contracts";
import { IsIn } from "class-validator";

export class UpdateMedicStatusDto implements UpdateMedicStatusRequest {
  @IsIn(["available", "rest"])
  status!: "available" | "rest";
}
