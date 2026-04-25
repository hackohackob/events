import { Injectable } from "@nestjs/common";

interface AssignmentRecord {
  incidentId: string;
  paramedicId: string;
  status: "assigned" | "accepted" | "arrived" | "closed";
}

@Injectable()
export class AssignmentsService {
  private readonly assignments: AssignmentRecord[] = [];

  assign(incidentId: string, paramedicId: string): AssignmentRecord {
    const assignment: AssignmentRecord = {
      incidentId,
      paramedicId,
      status: "assigned",
    };
    this.assignments.push(assignment);
    return assignment;
  }

  listByIncident(incidentId: string): AssignmentRecord[] {
    return this.assignments.filter((item) => item.incidentId === incidentId);
  }
}
