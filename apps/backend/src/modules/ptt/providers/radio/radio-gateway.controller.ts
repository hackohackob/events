import { createReadStream } from "node:fs";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";

/**
 * Just enough of Express's response for the one streaming route below. The
 * backend does not depend on `@types/express`, and adding it for two method
 * signatures would be a heavier change than describing them.
 */
interface StreamableResponse {
  set(headers: Record<string, string>): unknown;
  on(event: string, listener: () => void): unknown;
  write(chunk: unknown): boolean;
  end(): unknown;
}
import { FileInterceptor } from "@nestjs/platform-express";
import type {
  RadioGatewayReportRequest,
  RadioGatewayReportResponse,
} from "@events/contracts";
import { PttBridgeService } from "../../ptt-bridge.service";
import { PttSettingsService } from "../../ptt-settings.service";
import { RadioBundleService } from "./radio-bundle.service";
import { RadioProvider } from "./radio.provider";
import { RadioGatewayService, type QueuedOutbound } from "./radio-gateway.service";

/**
 * The device-facing half of the radio bridge — the only endpoints a gateway box
 * ever calls. Deliberately outside the app's `AuthGuard`: a box has no user
 * session, it presents the shared gateway key in `X-Gateway-Key` and nothing
 * else. Every route here is therefore explicit about checking it.
 *
 * Nothing here is reachable while the radio provider is switched off, which
 * doubles as a kill switch for the whole fleet.
 */
@Controller("radio-gateway")
export class RadioGatewayController {
  /** Slightly under the usual 30 s proxy read timeout. */
  private static readonly POLL_MS = 25_000;

  constructor(
    private readonly gateways: RadioGatewayService,
    private readonly provider: RadioProvider,
    private readonly settings: PttSettingsService,
    private readonly bridge: PttBridgeService,
    private readonly bundles: RadioBundleService,
  ) {}

  private authorize(key: string | undefined): void {
    if (!this.provider.isEnabled()) {
      throw new UnauthorizedException("radio bridge is switched off");
    }
    if (!key || !this.provider.accepts(key.trim())) {
      throw new UnauthorizedException("bad gateway key");
    }
  }

  /**
   * Heartbeat, once a minute. Everything the box needs comes back in the
   * response: its binding, the events it may pick from, the event's routing
   * switches and any queued commands.
   */
  @Post("report")
  async report(
    @Headers("x-gateway-key") key: string,
    @Body() body: RadioGatewayReportRequest,
  ): Promise<RadioGatewayReportResponse> {
    this.authorize(key);
    if (!body?.id) throw new BadRequestException("missing gateway id");

    const { record, events, commands } = await this.gateways.report(body);
    const eventId = record.eventId ?? undefined;
    const routes = eventId
      ? (await this.settings.routes(eventId)).routes.find((r) => r.kind === "radio")
      : undefined;

    return {
      ok: true,
      serverTime: new Date().toISOString(),
      eventId,
      events,
      routes: { inbound: routes?.inbound ?? true, outbound: routes?.outbound ?? true },
      ttsEnabled: record.ttsEnabled,
      commands,
      latestVersion: this.bundles.latestVersion(),
    };
  }

  /**
   * Long-poll for things to transmit. Returns as soon as anything is queued,
   * and empty-handed after ~25 s so the box can renew the request — which is
   * also how it notices the link died.
   */
  @Get("stream")
  async stream(
    @Headers("x-gateway-key") key: string,
    @Query("id") id: string,
  ): Promise<{ items: QueuedOutbound[] }> {
    this.authorize(key);
    if (!id) throw new BadRequestException("missing gateway id");
    const items = await this.gateways.waitForOutbound(id, RadioGatewayController.POLL_MS);
    return { items };
  }

  /** The box's setup screen picking which event this handset belongs to. */
  @Post("select-event")
  async selectEvent(
    @Headers("x-gateway-key") key: string,
    @Body() body: { id: string; eventId: string | null },
  ): Promise<{ ok: true }> {
    this.authorize(key);
    if (!body?.id) throw new BadRequestException("missing gateway id");
    await this.gateways.selectEvent(body.id, body.eventId);
    return { ok: true };
  }

  /**
   * A finished over-the-air transmission. The audio is handed straight to the
   * bridge, which stores it, transcribes it and posts it into the bound event's
   * team chat — the same path Zello voice takes.
   */
  @Post("voice")
  @UseInterceptors(FileInterceptor("audio"))
  async voice(
    @Headers("x-gateway-key") key: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Body() body: { id: string; durationMs?: string; from?: string; peakLevel?: string },
  ): Promise<{ ok: true; accepted: boolean }> {
    this.authorize(key);
    if (!file?.buffer?.length) throw new BadRequestException("missing audio");
    if (!body?.id) throw new BadRequestException("missing gateway id");

    const eventId = this.gateways.boundEvent(body.id);
    if (!eventId) return { ok: true, accepted: false };

    const extension = (file.originalname?.split(".").pop() || "ogg").toLowerCase();
    const durationMs = Number(body.durationMs ?? 0) || 0;
    const from = body.from?.trim() || "Radio";

    const stored = await this.bridge.ingestRadioVoice({
      eventId,
      from,
      audio: file.buffer,
      extension,
      durationMs,
    });

    await this.gateways.recordTransmission({
      gatewayId: body.id,
      direction: "rx",
      at: new Date().toISOString(),
      durationMs,
      audioUrl: stored?.audioUrl,
      transcript: stored?.transcript,
      party: from,
      peakLevel: Number(body.peakLevel ?? 0) || undefined,
    });

    return { ok: true, accepted: true };
  }

  /** Confirmation that something queued here actually made it to the air. */
  @Post("transmitted")
  async transmitted(
    @Headers("x-gateway-key") key: string,
    @Body() body: { id: string; durationMs?: number; party?: string; text?: string },
  ): Promise<{ ok: true }> {
    this.authorize(key);
    if (!body?.id) throw new BadRequestException("missing gateway id");
    await this.gateways.recordTransmission({
      gatewayId: body.id,
      direction: "tx",
      at: new Date().toISOString(),
      durationMs: body.durationMs ?? 0,
      transcript: body.text,
      party: body.party,
    });
    return { ok: true };
  }

  /**
   * Text rendered to speech for the box. Kept server-side so the appliance
   * needs no API keys of its own and every box benefits from the same cache.
   */
  @Post("speak")
  async speak(
    @Headers("x-gateway-key") key: string,
    @Body() body: { text: string },
  ): Promise<{ ok: true; audioUrl: string | null }> {
    this.authorize(key);
    const text = body?.text?.trim();
    if (!text) throw new BadRequestException("missing text");
    const audioUrl = await this.bridge.speak(text);
    return { ok: true, audioUrl };
  }

  // ── Firmware ───────────────────────────────────────────────────────────────

  /** What the box compares against its own version before downloading. */
  @Get("bundle.json")
  bundleMeta(@Headers("x-gateway-key") key: string): {
    version: string;
    sha256: string;
    size: number;
    notes?: string;
  } {
    this.authorize(key);
    const bundle = this.bundles.current();
    if (!bundle) throw new NotFoundException("no gateway release has been published");
    return { version: bundle.version, sha256: bundle.sha256, size: bundle.size, notes: bundle.notes };
  }

  /** The release tarball itself. Streamed — these run to tens of megabytes. */
  @Get("bundle")
  bundle(@Headers("x-gateway-key") key: string, @Res() res: StreamableResponse): void {
    this.authorize(key);
    const bundle = this.bundles.current();
    if (!bundle) throw new NotFoundException("no gateway release has been published");
    res.set({
      "Content-Type": "application/gzip",
      "Content-Length": String(bundle.size),
      "Content-Disposition": `attachment; filename="em-gateway-${bundle.version}.tar.gz"`,
    });
    createReadStream(bundle.path).pipe(res as unknown as NodeJS.WritableStream);
  }
}
