import { Injectable } from "@nestjs/common";
import { ExampleDataService } from "../example-data/example-data.service";

export interface UnitSummary {
  id: string;
  unitNumber: string;
  name: string;
  vehicle: string;
  status: "available" | "responding" | "standby";
  avatarUrl: string;
}

@Injectable()
export class UnitsService {
  constructor(private readonly exampleDataService: ExampleDataService) {}

  list(): UnitSummary[] {
    return this.exampleDataService.listNamedParamedics().map((paramedic, index) => ({
      id: paramedic.userId,
      unitNumber: paramedic.unitNumber,
      name: paramedic.name,
      vehicle: paramedic.vehicle,
      status: index < 3 ? "responding" : index < 7 ? "available" : "standby",
      avatarUrl: paramedic.avatarUrl,
    }));
  }
}
