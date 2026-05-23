import { Injectable } from "@nestjs/common";
import { Pool, type PoolConfig, QueryResult, QueryResultRow } from "pg";

@Injectable()
export class DbService {
  private readonly pool = new Pool(this.createPoolConfig());

  private createPoolConfig(): PoolConfig {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    const fallbackPassword =
      process.env.POSTGRES_PASSWORD ??
      process.env.PGPASSWORD ??
      "events";

    if (databaseUrl) {
      try {
        const parsed = new URL(databaseUrl);
        if (!parsed.password) {
          parsed.password = fallbackPassword;
        }
        return { connectionString: parsed.toString() };
      } catch {
        return { connectionString: databaseUrl };
      }
    }

    return {
      host: process.env.POSTGRES_HOST ?? process.env.PGHOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? process.env.PGPORT ?? "8502"),
      user: process.env.POSTGRES_USER ?? process.env.PGUSER ?? "events",
      password: fallbackPassword,
      database: process.env.POSTGRES_DB ?? process.env.PGDATABASE ?? "events",
    };
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }
}
