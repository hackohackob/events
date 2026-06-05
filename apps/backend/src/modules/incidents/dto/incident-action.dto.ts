import { IncidentActionRequest } from "@events/contracts";
import { IsIn, IsString } from "class-validator";

const actions = ["going", "arrived", "need_backup", "resolved", "stand_down"] as const;

export class IncidentActionDto implements Omit<IncidentActionRequest, "incidentId"> {
  @IsString()
  @IsIn(actions)
  action!: IncidentActionRequest["action"];
}
