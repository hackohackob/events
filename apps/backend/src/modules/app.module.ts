import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AssignmentsModule } from "./assignments/assignments.module";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { ExampleDataModule } from "./example-data/example-data.module";
import { EventsModule } from "./events/events.module";
import { FieldGuideModule } from "./field-guide/field-guide.module";
import { GuidanceModule } from "./guidance/guidance.module";
import { EventUsersModule } from "./event-users/event-users.module";
import { HealthModule } from "./health/health.module";
import { IncidentsModule } from "./incidents/incidents.module";
import { InfraModule } from "./infra/infra.module";
import { LocationsModule } from "./locations/locations.module";
import { MapModule } from "./map/map.module";
import { MedicsModule } from "./medics/medics.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { RoutingModule } from "./routing/routing.module";
import { SearchModule } from "./search/search.module";
import { UnitsModule } from "./units/units.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    ExampleDataModule,
    InfraModule,
    HealthModule,
    AuthModule,
    EventsModule,
    FieldGuideModule,
    EventUsersModule,
    LocationsModule,
    MapModule,
    MedicsModule,
    NotificationsModule,
    IncidentsModule,
    GuidanceModule,
    AssignmentsModule,
    RealtimeModule,
    RoutingModule,
    SearchModule,
    UnitsModule,
    UsersModule,
  ],
})
export class AppModule {}
