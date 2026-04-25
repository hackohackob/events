import { Injectable } from "@nestjs/common";
import { ExampleDataService } from "../example-data/example-data.service";

interface RunnerRecord {
  eventId: string;
  userId: string;
  name: string;
  bibNumber: string;
  lastLat: number;
  lastLng: number;
  lastUpdate: string;
}

@Injectable()
export class SearchService {
  constructor(private readonly exampleDataService: ExampleDataService) {}

  search(eventId: string, query: { name?: string; bibNumber?: string }): RunnerRecord[] {
    return this.exampleDataService.listRunners(eventId).filter((runner) => {
      if (runner.eventId !== eventId) return false;
      if (query.name && !runner.name.toLowerCase().includes(query.name.toLowerCase())) return false;
      if (query.bibNumber && runner.bibNumber !== query.bibNumber) return false;
      return true;
    });
  }
}
