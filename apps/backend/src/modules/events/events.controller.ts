import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { EventsService } from "./events.service";

@Controller("events")
@UseGuards(AuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list() {
    return this.eventsService.list();
  }

  @Get("tracks")
  tracks() {
    return this.eventsService.listTracks();
  }
}
