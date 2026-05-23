import {
  Body,
  Controller,
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
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { IncidentActionDto } from "./dto/incident-action.dto";
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

  @Patch(":incidentId/action")
  @Roles("paramedic", "coordinator")
  action(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Body() body: IncidentActionDto,
  ) {
    return this.incidentsService.applyAction(user.eventId, incidentId, user.userId, body);
  }

  @Patch(":incidentId/assign/:paramedicId")
  @Roles("coordinator")
  assign(
    @CurrentUser() user: RequestUser,
    @Param("incidentId") incidentId: string,
    @Param("paramedicId") paramedicId: string,
  ) {
    return this.incidentsService.assign(user.eventId, incidentId, paramedicId);
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
  uploadPhoto(
    @Param("incidentId") _incidentId: string,
    @UploadedFile() file: { filename: string; path: string; mimetype: string },
  ) {
    return { url: `/uploads/incidents/${file.filename}` };
  }
}
