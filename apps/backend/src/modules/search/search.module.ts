import { Module } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { EventsModule } from "../events/events.module";
import { PlacesService } from "./places.service";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [ExampleDataModule, EventsModule],
  controllers: [SearchController],
  providers: [SearchService, PlacesService],
})
export class SearchModule {}
