import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AssignmentsModule } from "./assignments/assignments.module";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { ExampleDataModule } from "./example-data/example-data.module";
import { EventsModule } from "./events/events.module";
import { EventUsersModule } from "./event-users/event-users.module";
import { HealthModule } from "./health/health.module";
import { IncidentsModule } from "./incidents/incidents.module";
import { InfraModule } from "./infra/infra.module";
import { LocationsModule } from "./locations/locations.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { SearchModule } from "./search/search.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    ExampleDataModule,
    InfraModule,
    HealthModule,
    AuthModule,
    EventsModule,
    EventUsersModule,
    LocationsModule,
    IncidentsModule,
    AssignmentsModule,
    RealtimeModule,
    SearchModule,
  ],
})
export class AppModule {}
