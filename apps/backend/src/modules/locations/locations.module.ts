import { Module } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { MedicsModule } from "../medics/medics.module";
import { LocationsController } from "./locations.controller";
import { LocationsService } from "./locations.service";

@Module({
  imports: [ExampleDataModule, MedicsModule],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
