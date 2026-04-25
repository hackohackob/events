import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeRedisBridge } from "./realtime-redis.bridge";

@Module({
  providers: [RealtimeGateway, RealtimeRedisBridge],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
