import { Controller, Get, Header, Param, StreamableFile } from "@nestjs/common";
import { WeatherService } from "./weather.service";

/**
 * Public (no-auth) weather overlays. The runner PWA drops these as MapLibre image
 * overlays over Bulgaria, so they must be fetchable without auth headers. Each is
 * a small PNG for one field + forecast hour, rendered + cached by WeatherService.
 */
@Controller("weather")
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get("overlay/:field/:hour")
  @Header("Cache-Control", "public, max-age=600")
  async overlay(@Param("field") field: string, @Param("hour") hour: string): Promise<StreamableFile> {
    const buf = await this.weather.getOverlay(field, Number(String(hour).replace(/\.[a-z]+$/i, "")));
    return new StreamableFile(buf, { type: "image/png" });
  }
}
