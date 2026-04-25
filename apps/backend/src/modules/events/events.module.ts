import { Module } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  imports: [ExampleDataModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
