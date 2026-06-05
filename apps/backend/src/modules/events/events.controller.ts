import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../common/guards/auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequestUser } from "../common/types/request-user.type";
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
  async create(@Body() body: CreateEventDto) {
    return this.eventsService.create(body);
  }

  @Get("tracks")
  async tracks(@CurrentUser() user: RequestUser) {
    const eventTracks = await this.eventsService.listTracksForEvent(user.eventId);
    if (eventTracks.length > 0) return eventTracks;
    return this.eventsService.listTracks();
  }

  @Get("pois")
  pois(@CurrentUser() user: RequestUser) {
    return this.eventsService.listPoisForEvent(user.eventId);
  }

  @Post("pois")
  createPoi(
    @CurrentUser() user: RequestUser,
    @Body() body: { lat: number; lng: number; type?: string; name?: string; description?: string },
  ) {
    return this.eventsService.createPoi(user.eventId, body);
  }

  @Delete("pois/:poiId")
  archivePoi(@CurrentUser() user: RequestUser, @Param("poiId") poiId: string) {
    return this.eventsService.archivePoi(user.eventId, poiId);
  }

  @Patch(":id/pois/:poiId")
  updatePoi(
    @Param("id") id: string,
    @Param("poiId") poiId: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.eventsService.updatePoi(id, poiId, body);
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: CreateEventDto) {
    const event = await this.eventsService.update(id, body);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    const event = this.eventsService.findById(id);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  @Patch(":id/activate")
  async activate(@Param("id") id: string) {
    const event = await this.eventsService.activate(id);
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    const deleted = await this.eventsService.remove(id);
    if (!deleted) throw new NotFoundException(`Event ${id} not found`);
    return { id };
  }

  @Post("gpx")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadGPX(@UploadedFile() file: { buffer: Buffer; originalname: string }) {
    const url = await this.eventsService.storeGPX(file);
    return { url };
  }
}
