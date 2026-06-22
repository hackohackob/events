import { Module } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { EventChatModule } from "../event-chat/event-chat.module";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  imports: [ExampleDataModule, EventChatModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
