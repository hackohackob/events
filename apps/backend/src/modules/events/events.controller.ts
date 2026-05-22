import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../common/guards/auth.guard";
import { CreateEventDto } from "./dto/create-event.dto";
import { EventsService } from "./events.service";

@Controller("events")
@UseGuards(AuthGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list() {
    return this.eventsService.list();
  }

  @Post()
  create(@Body() body: CreateEventDto) {
    return this.eventsService.create(body);
  }

  @Get("tracks")
  tracks() {
    return this.eventsService.listTracks();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    const event = this.eventsService.findById(id);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  @Patch(":id/activate")
  activate(@Param("id") id: string) {
    const event = this.eventsService.activate(id);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  @Post("gpx")
  @UseInterceptors(FileInterceptor("file"))
  async uploadGPX(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    const url = await this.eventsService.storeGPX(file);
    return { url };
  }
}
