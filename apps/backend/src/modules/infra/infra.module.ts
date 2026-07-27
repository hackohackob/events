import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";
import { PttBusService } from "./ptt-bus.service";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [DbService, PttBusService, RedisService],
  exports: [DbService, PttBusService, RedisService],
})
export class InfraModule {}
