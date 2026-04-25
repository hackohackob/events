import { Injectable, Logger } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    retryStrategy: (attempt) => Math.min(1000 * attempt, 5000),
  });

  constructor() {
    this.redis.on("error", (error) => {
      this.logger.warn(`Redis unavailable: ${error.message}`);
    });
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redis.set(key, payload, "EX", ttlSeconds);
        return;
      }
      await this.redis.set(key, payload);
    } catch (error) {
      this.logger.warn(`setJson skipped for ${key}: ${(error as Error).message}`);
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      this.logger.warn(`getJson failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    try {
      return await this.redis.publish(channel, JSON.stringify(payload));
    } catch (error) {
      this.logger.warn(`publish skipped for ${channel}: ${(error as Error).message}`);
      return 0;
    }
  }
}
