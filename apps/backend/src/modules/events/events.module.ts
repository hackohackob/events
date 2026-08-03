import { Module, forwardRef } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { EventChatModule } from "../event-chat/event-chat.module";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  // forwardRef: the chat now reaches back into incidents, which reach medics,
  // which reach this module — so EventChatModule is still being defined when
  // this one is evaluated.
  imports: [ExampleDataModule, forwardRef(() => EventChatModule)],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
