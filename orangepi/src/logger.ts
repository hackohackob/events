import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { EventEmitter } from "node:events";
import { dirname } from "node:path";
import { LOG_PATH } from "./config";

/**
 * The box's log, which is also a product surface: the console streams it live,
 * and it is usually the only way anyone can tell why a cable is not working.
 * So entries are written for a human standing next to a radio, not for grep.
 *
 * Three sinks, one call: an in-memory ring the console pages through, an SSE
 * fan-out for live tailing, and a rotated file that survives a reboot.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogScope = "system" | "wifi" | "audio" | "radio" | "server" | "console" | "update";

export interface LogEntry {
  seq: number;
  at: string;
  level: LogLevel;
  scope: LogScope;
  message: string;
  /** Small structured extras rendered as chips in the console. */
  data?: Record<string, string | number | boolean>;
}

const RING_SIZE = 3000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

class GatewayLog extends EventEmitter {
  private readonly ring: LogEntry[] = [];
  private seq = 0;
  private minLevel: LogLevel = (process.env.GATEWAY_LOG_LEVEL as LogLevel) || "info";

  private static readonly ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

  write(level: LogLevel, scope: LogScope, message: string, data?: LogEntry["data"]): void {
    if (GatewayLog.ORDER[level] < GatewayLog.ORDER[this.minLevel]) return;
    const entry: LogEntry = { seq: ++this.seq, at: new Date().toISOString(), level, scope, message, data };

    this.ring.push(entry);
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE);
    this.emit("entry", entry);

    // journald already has stdout; the file is for reading the last boot's
    // story from the console when nobody has an SSH session open.
    const line = `${entry.at} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${
      data ? ` ${JSON.stringify(data)}` : ""
    }`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    this.persist(line);
  }

  private persist(line: string): void {
    try {
      mkdirSync(dirname(LOG_PATH), { recursive: true });
      if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_FILE_BYTES) {
        renameSync(LOG_PATH, `${LOG_PATH}.1`);
      }
      appendFileSync(LOG_PATH, `${line}\n`);
    } catch {
      // A full or read-only disk must never take the bridge down.
    }
  }

  /** Newest last. `after` streams only what the console has not seen. */
  recent(limit = 500, after = 0): LogEntry[] {
    const slice = after > 0 ? this.ring.filter((e) => e.seq > after) : this.ring;
    return slice.slice(-limit);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(scope: LogScope, message: string, data?: LogEntry["data"]): void {
    this.write("debug", scope, message, data);
  }
  info(scope: LogScope, message: string, data?: LogEntry["data"]): void {
    this.write("info", scope, message, data);
  }
  warn(scope: LogScope, message: string, data?: LogEntry["data"]): void {
    this.write("warn", scope, message, data);
  }
  error(scope: LogScope, message: string, data?: LogEntry["data"]): void {
    this.write("error", scope, message, data);
  }
}

export const log = new GatewayLog();
