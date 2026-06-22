import { Body, Controller, Get, Post, UseGuards, UseInterceptors, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { extname, join } from "path";
import { existsSync, mkdirSync } from "fs";
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */
const { diskStorage } = require("multer") as { diskStorage: (opts: any) => any };
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */
import type { EventMessage } from "@events/contracts";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RequestUser } from "../common/types/request-user.type";
import { TranscriptionService } from "../incidents/transcription.service";
import { EventChatService } from "./event-chat.service";

const UPLOADS_DIR = join(process.cwd(), "uploads", "event-chat");
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

@Controller("event-chat")
@UseGuards(AuthGuard, RolesGuard)
export class EventChatController {
  constructor(
    private readonly chat: EventChatService,
    private readonly transcription: TranscriptionService,
  ) {}

  @Get("messages")
  @Roles("paramedic", "coordinator", "medic", "runner")
  list(@CurrentUser() user: RequestUser): Promise<EventMessage[]> {
    return this.chat.list(user.eventId);
  }

  @Post("messages")
  @Roles("paramedic", "coordinator", "medic", "runner")
  async send(@CurrentUser() user: RequestUser, @Body() body: { text?: string }): Promise<EventMessage> {
    const name = await this.chat.resolveAuthorName(user.eventId, user.userId);
    return this.chat.addText(user.eventId, user.userId, name, (body.text ?? "").trim());
  }

  @Post("voice")
  @Roles("paramedic", "coordinator", "medic", "runner")
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
  async voice(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: { filename: string; path: string; mimetype: string },
    @Body("durationMs") durationMs?: string,
  ): Promise<EventMessage> {
    const url = `/uploads/event-chat/${file.filename}`;
    const parsedDuration = Number(durationMs);
    const transcript = await this.transcription.transcribe(file.path, file.mimetype).catch(() => null);
    const name = await this.chat.resolveAuthorName(user.eventId, user.userId);
    return this.chat.addVoice(user.eventId, user.userId, name, {
      audioUrl: url,
      audioDurationMs: Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.round(parsedDuration) : undefined,
      transcript: transcript ?? undefined,
    });
  }
}
