import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { extname, join } from "path";
import { existsSync, mkdirSync } from "fs";

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */
const { diskStorage } = require("multer") as { diskStorage: (opts: any) => any };
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { CloseIncidentDto } from "./dto/close-incident.dto";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { IncidentActionDto } from "./dto/incident-action.dto";
import { SendIncidentMessageDto } from "./dto/incident-message.dto";
import { UpdateIncidentDetailsDto } from "./dto/update-incident-details.dto";
import { IncidentsService } from "./incidents.service";

const UPLOADS_DIR = join(process.cwd(), "uploads", "incidents");
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

@Controller("incidents")
@UseGuards(AuthGuard, RolesGuard)
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: CreateIncidentDto) {
    return this.incidentsService.create(user.eventId, user.userId, body);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.incidentsService.list(user.eventId, user.role);
  }

  /** Incidents the caller reported themselves (runner SOS follow-up). */
  @Get("mine")
  listMine(@CurrentUser() user: RequestUser) {
    return this.incidentsService.listMine(user.eventId, user.userId);
  }

  @Patch(":incidentId/action")
  @Roles("paramedic", "coordinator", "medic")
  action(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Body() body: IncidentActionDto,
  ) {
    return this.incidentsService.applyAction(user.eventId, incidentId, user.userId, body);
  }

  @Patch(":incidentId/assign/:paramedicId")
  @Roles("coordinator", "medic")
  assign(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Param("paramedicId") paramedicId: string,
  ) {
    return this.incidentsService.assign(user.eventId, incidentId, paramedicId);
  }

  @Delete(":incidentId/assign/:paramedicId")
  // Roster coordinators carry x-role "medic" from the app session, so the
  // role gate is broad here; the service enforces coordinator-or-self.
  @Roles("coordinator", "medic", "paramedic")
  unassign(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Param("paramedicId") paramedicId: string,
  ) {
    return this.incidentsService.unassign(user.eventId, incidentId, paramedicId, {
      userId: user.userId,
      role: user.role,
    });
  }

  @Patch(":incidentId/close")
  @Roles("paramedic", "coordinator", "medic")
  close(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Body() body: CloseIncidentDto,
  ) {
    return this.incidentsService.close(user.eventId, incidentId, user.userId, body);
  }

  @Get(":incidentId/messages")
  listMessages(@CurrentUser() user: RequestUser, @Param("incidentId") incidentId: string) {
    return this.incidentsService.listMessages(user.eventId, incidentId);
  }

  @Post(":incidentId/messages")
  @Roles("paramedic", "coordinator", "medic")
  sendMessage(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Body() body: SendIncidentMessageDto,
  ) {
    return this.incidentsService.addMessage(user.eventId, incidentId, user.userId, body);
  }

  @Patch(":incidentId")
  @Roles("paramedic", "coordinator", "medic")
  updateDetails(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Body() body: UpdateIncidentDetailsDto,
  ) {
    return this.incidentsService.updateDetails(user.eventId, incidentId, body);
  }

  @Post(":incidentId/photo")
  @Roles("paramedic", "coordinator", "medic")
  @UseInterceptors(
    FileInterceptor("photo", {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req: any, file: any, cb: (err: null, name: string) => void) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `${unique}${extname(file.originalname as string)}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async uploadPhoto(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @UploadedFile() file: { filename: string; path: string; mimetype: string },
  ) {
    const url = `/uploads/incidents/${file.filename}`;
    // Attach immediately so photos added after the report show up for everyone.
    const incident = await this.incidentsService.addPhoto(user.eventId, incidentId, url);
    return { url, photoUrls: incident.photoUrls };
  }

  @Post(":incidentId/voice")
  @Roles("paramedic", "coordinator", "medic")
  @UseInterceptors(
    FileInterceptor("audio", {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req: any, file: any, cb: (err: null, name: string) => void) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
          cb(null, `voice-${unique}${extname(file.originalname as string) || ".m4a"}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async uploadVoice(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @UploadedFile() file: { filename: string; path: string; mimetype: string },
    @Body("durationMs") durationMs?: string,
  ) {
    const url = `/uploads/incidents/${file.filename}`;
    const parsedDuration = Number(durationMs);
    // A voice note is just a chat message with an audio attachment — it lands
    // in the incident chat and is broadcast like any other message.
    return this.incidentsService.addMessage(user.eventId, incidentId, user.userId, {
      text: "",
      audioUrl: url,
      audioDurationMs: Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.round(parsedDuration) : undefined,
    });
  }
}
