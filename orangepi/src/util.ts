import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command and collect its output. Never rejects on a non-zero exit —
 * almost every caller here wants to inspect the code and carry on, because a
 * missing `nmcli` or `arecord` should degrade the box, not crash it.
 */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
      : null;

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Whether a binary exists on PATH. Probed once per name. */
const probes = new Map<string, Promise<boolean>>();
export function hasBinary(name: string): Promise<boolean> {
  let probe = probes.get(name);
  if (!probe) {
    probe = run("sh", ["-c", `command -v ${name}`]).then((r) => r.code === 0 && r.stdout.trim().length > 0);
    probes.set(name, probe);
  }
  return probe;
}

/** True on a dev laptop, where none of the radio hardware exists. */
export const FAKE_HARDWARE = process.env.GATEWAY_FAKE_HARDWARE === "1";
