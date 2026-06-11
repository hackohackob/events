import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { resolveRedisUrl } from "../infra/redis.service";
import { RealtimeGateway } from "./realtime.gateway";

interface RedisEvent {
  type: string;
  payload: unknown;
}

@Injectable()
export class RealtimeRedisBridge implements OnModuleInit {
  private readonly logger = new Logger(RealtimeRedisBridge.name);
  private readonly subscriber = new Redis(resolveRedisUrl());

  constructor(private readonly realtimeGateway: RealtimeGateway) {
    this.subscriber.on("error", (error) => {
      this.logger.warn(`Redis subscriber unavailable: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.subscriber.psubscribe("event:*");
    } catch (error) {
      this.logger.warn(`Redis psubscribe failed: ${(error as Error).message}`);
      return;
    }
    this.subscriber.on("pmessage", (_pattern, channel, message) => {
      const parsed = this.safeParse(message);
      this.realtimeGateway.server.to(channel).emit(parsed.type, parsed.payload);
    });
  }

  private safeParse(payload: string): RedisEvent {
    try {
      return JSON.parse(payload) as RedisEvent;
    } catch {
      return { type: "unknown", payload };
    }
  }
}
