import { Injectable, Logger } from "@nestjs/common";
import Redis from "ioredis";

/** This project's redis from docker-compose (REDIS_PORT, default 8501) — NOT
 *  6379, which silently piggybacked on whatever other project had redis up. */
export function resolveRedisUrl(): string {
  return process.env.REDIS_URL ?? `redis://localhost:${process.env.REDIS_PORT ?? "8501"}`;
}

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis = new Redis(resolveRedisUrl(), {
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
