import { Module } from "@nestjs/common";
import { WeatherController } from "./weather.controller";
import { WeatherService } from "./weather.service";

/** Open-Meteo weather overlays (Bulgaria), rendered + cached server-side. */
@Module({
  controllers: [WeatherController],
  providers: [WeatherService],
})
export class WeatherModule {}
