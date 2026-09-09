import { useEffect, useRef } from "react";
import type { Levels, ToneEvent } from "../lib/useGateway";

/**
 * The channel scope — the last thirty seconds of the radio channel, received
 * above the centre line and transmitted below it, with the beeps marked.
 *
 * Two decisions shape everything here.
 *
 * The trace is positioned by **time**, not by sample index. Levels arrive about
 * eight times a second while the display refreshes sixty; indexing by sample
 * made the trace advance in visible steps. Placing every sample at
 * `now - t` pixels from the right edge instead means the picture slides
 * continuously and the pen sits still — which is what makes it read as an
 * instrument rather than a chart being redrawn.
 *
 * Nothing here goes through React. Samples land in a ref and the whole thing is
 * drawn from one requestAnimationFrame loop; re-rendering a component tree at
 * 60 Hz on a phone is exactly how a page like this ends up feeling cheap.
 */

/** How much history is on screen. */
const WINDOW_MS = 30_000;
/** Full-scale for the trace. Radio audio rarely approaches 1.0. */
const FULL_SCALE = 0.65;
/** Samples are dropped once older than this; a little more than the window. */
const KEEP_MS = WINDOW_MS + 2_000;

interface Sample extends Levels {
  t: number;
}

export function Scope({
  subscribe,
  subscribeTones,
  openLevel,
  closeLevel,
  beepsEnabled,
}: {
  subscribe: (fn: (levels: Levels) => void) => () => void;
  subscribeTones: (fn: (tone: ToneEvent) => void) => () => void;
  openLevel: number;
  closeLevel: number;
  beepsEnabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Sample[]>([]);
  const tones = useRef<ToneEvent[]>([]);
  const config = useRef({ openLevel, closeLevel, beepsEnabled });
  config.current = { openLevel, closeLevel, beepsEnabled };

  useEffect(
    () =>
      subscribe((levels) => {
        samples.current.push({ ...levels, t: performance.now() });
      }),
    [subscribe],
  );

  useEffect(
    () =>
      subscribeTones((tone) => {
        tones.current.push(tone);
      }),
    [subscribeTones],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (): void => {
      frame = requestAnimationFrame(draw);
      if (!width || !height) return;

      const now = performance.now();
      const pxPerMs = width / WINDOW_MS;
      const mid = height / 2;
      const scale = mid * 0.88;
      const { openLevel: open, closeLevel: close, beepsEnabled: beeps } = config.current;

      // Drop what has scrolled off, so neither array grows without bound.
      const cutoff = now - KEEP_MS;
      while (samples.current.length && samples.current[0]!.t < cutoff) samples.current.shift();
      while (tones.current.length && tones.current[0]!.at < cutoff) tones.current.shift();

      const x = (t: number): number => width - (now - t) * pxPerMs;
      const y = (value: number, up: boolean): number => {
        const v = Math.min(1, Math.max(0, value) / FULL_SCALE);
        return up ? mid - v * scale : mid + v * scale;
      };

      ctx.clearRect(0, 0, width, height);

      // ── Time grid, sliding with the trace ────────────────────────────────
      // Anchored to absolute time rather than to the frame, so the lines move
      // with the signal instead of shimmering in place.
      ctx.save();
      ctx.strokeStyle = "rgba(148,163,184,0.07)";
      ctx.lineWidth = 1;
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(148,163,184,0.28)";
      ctx.textAlign = "center";
      const STEP_MS = 5_000;
      const firstTick = Math.ceil((now - WINDOW_MS) / STEP_MS) * STEP_MS;
      for (let t = firstTick; t <= now; t += STEP_MS) {
        const gx = Math.round(x(t)) + 0.5;
        if (gx < 12 || gx > width - 2) continue;
        ctx.beginPath();
        ctx.moveTo(gx, 10);
        ctx.lineTo(gx, height - 10);
        ctx.stroke();
        const age = Math.round((now - t) / 1000);
        if (age > 0) ctx.fillText(`${age}s`, gx, height - 2);
      }
      ctx.restore();

      // ── Centre line and squelch thresholds ───────────────────────────────
      ctx.strokeStyle = "rgba(148,163,184,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();

      const threshold = (value: number, color: string, dash: number[]): void => {
        ctx.save();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.beginPath();
        const ty = y(value, true) + 0.5;
        ctx.moveTo(0, ty);
        ctx.lineTo(width, ty);
        ctx.stroke();
        ctx.restore();
      };
      threshold(open, "rgba(34,197,94,0.4)", [4, 4]);
      threshold(close, "rgba(148,163,184,0.25)", [2, 5]);

      const data = samples.current;
      if (data.length >= 2) {
        // ── Filled traces ──────────────────────────────────────────────────
        const rxFill = ctx.createLinearGradient(0, 0, 0, mid);
        rxFill.addColorStop(0, "rgba(34,197,94,0.5)");
        rxFill.addColorStop(1, "rgba(34,197,94,0.04)");
        const txFill = ctx.createLinearGradient(0, mid, 0, height);
        txFill.addColorStop(0, "rgba(245,158,11,0.04)");
        txFill.addColorStop(1, "rgba(245,158,11,0.5)");

        // Stroke the trace only when there is something to outline. A flat line
        // at zero drawn in a bright colour reads as a fault rather than as
        // silence, and the two flat traces stacked on the centre line made the
        // idle scope look like an error state.
        const peakOf = (pick: (s: Sample) => number): number =>
          data.reduce((max, sample) => Math.max(max, pick(sample)), 0);

        const trace = (
          pick: (s: Sample) => number,
          up: boolean,
          fill: CanvasGradient,
          stroke: string,
        ): void => {
          const quiet = peakOf(pick) < 0.01;
          ctx.beginPath();
          ctx.moveTo(x(data[0]!.t), mid);
          for (const sample of data) ctx.lineTo(x(sample.t), y(pick(sample), up));
          ctx.lineTo(x(data[data.length - 1]!.t), mid);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();

          if (quiet) return;
          ctx.beginPath();
          data.forEach((sample, i) => {
            const px = x(sample.t);
            const py = y(pick(sample), up);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        };

        trace((s) => s.rx, true, rxFill, "rgba(74,222,128,0.85)");
        trace((s) => s.tx, false, txFill, "rgba(251,191,36,0.85)");

        // ── Open-squelch / keyed stripes on the centre line ────────────────
        for (let i = 1; i < data.length; i++) {
          const a = data[i - 1]!;
          const b = data[i]!;
          if (!a.receiving && !a.transmitting) continue;
          const x0 = x(a.t);
          const x1 = x(b.t);
          ctx.fillStyle = a.transmitting ? "rgba(245,158,11,0.95)" : "rgba(34,197,94,0.95)";
          ctx.fillRect(x0, mid - 1.5, Math.max(1, x1 - x0), 3);
        }
      }

      // ── Beep markers ─────────────────────────────────────────────────────
      // Drawn last so they sit above the trace. The whole point of showing
      // these is to make it obvious whether tone detection is firing, and on
      // which edge of a transmission.
      if (beeps) {
        for (const tone of tones.current) {
          const tx = x(tone.at);
          if (tx < -10 || tx > width + 10) continue;
          const opening = tone.kind === "open";
          const color = opening ? "#38bdf8" : "#f472b6";
          const age = now - tone.at;
          // Fresh marks flare briefly, so a beep is noticeable as it happens
          // and unobtrusive once it has scrolled back.
          const flare = Math.max(0, 1 - age / 900);

          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.45 + flare * 0.55;
          ctx.lineWidth = 1 + flare;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(tx, 8);
          ctx.lineTo(tx, height - 8);
          ctx.stroke();
          ctx.restore();

          // A diamond on the centre line: pointing up for an opening beep,
          // down for a closing one, so the two read differently at a glance.
          ctx.save();
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.85 + flare * 0.15;
          ctx.translate(tx, mid);
          ctx.beginPath();
          const r = 4 + flare * 2;
          if (opening) {
            ctx.moveTo(0, -r * 1.4);
            ctx.lineTo(r, 0);
            ctx.lineTo(-r, 0);
          } else {
            ctx.moveTo(0, r * 1.4);
            ctx.lineTo(r, 0);
            ctx.lineTo(-r, 0);
          }
          ctx.closePath();
          ctx.fill();
          if (flare > 0) {
            ctx.globalAlpha = flare * 0.5;
            ctx.beginPath();
            ctx.arc(0, 0, r + flare * 10, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }

      // ── The pen: fixed at the right edge ─────────────────────────────────
      const last = data[data.length - 1];
      const live = last && now - last.t < 1_500 ? last : null;
      const penX = width - 1.5;

      ctx.save();
      ctx.strokeStyle = "rgba(241,245,249,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(penX, 4);
      ctx.lineTo(penX, height - 4);
      ctx.stroke();
      ctx.restore();

      if (live) {
        const py = y(live.rx, true);
        const hot = live.receiving || live.transmitting;
        ctx.save();
        if (hot) {
          ctx.shadowColor = live.transmitting ? "rgba(245,158,11,0.9)" : "rgba(34,197,94,0.9)";
          ctx.shadowBlur = 12;
        }
        ctx.fillStyle = live.transmitting ? "#fbbf24" : live.receiving ? "#4ade80" : "rgba(148,163,184,0.7)";
        ctx.beginPath();
        ctx.arc(penX, py, hot ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="scope">
      <canvas ref={canvasRef} />
      <div className="scope-legend">
        <span style={{ color: "#22c55e" }}>
          <i /> In
        </span>
        <span style={{ color: "#f59e0b" }}>
          <i /> Out
        </span>
        {beepsEnabled && (
          <>
            <span style={{ color: "#38bdf8" }}>
              <i /> Open
            </span>
            <span style={{ color: "#f472b6" }}>
              <i /> Close
            </span>
          </>
        )}
      </div>
    </div>
  );
}
