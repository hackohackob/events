import { useEffect, useRef } from "react";
import type { Levels } from "../lib/useGateway";

/**
 * The channel scope — a scrolling history of the last ~30 seconds of the radio
 * channel, received above the centre line and transmitted below it.
 *
 * This is the panel that makes an invisible thing legible. A number ("rx 0.07")
 * tells an operator nothing; a shape they can see crossing the squelch line
 * tells them immediately whether the threshold is set where speech is and hiss
 * is not, which is the single setting most likely to be wrong on a new box.
 *
 * Drawn on a canvas from a ref-fed ring buffer rather than in React: the samples
 * arrive 8 times a second and the animation runs at the display's refresh rate.
 */
export function Scope({
  subscribe,
  openLevel,
  closeLevel,
}: {
  subscribe: (fn: (levels: Levels) => void) => () => void;
  openLevel: number;
  closeLevel: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samples = useRef<Levels[]>([]);
  const thresholds = useRef({ openLevel, closeLevel });
  thresholds.current = { openLevel, closeLevel };

  useEffect(() => subscribe((levels) => {
    samples.current.push(levels);
    if (samples.current.length > 480) samples.current.shift();
  }), [subscribe]);

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

      const mid = height / 2;
      // Two thirds of the half-height is full scale: radio audio rarely goes
      // near 1.0, and a meter that never leaves the bottom looks broken.
      const scale = (height / 2) * 0.92;
      const full = 0.65;

      ctx.clearRect(0, 0, width, height);

      // Centre line and the two squelch thresholds.
      ctx.strokeStyle = "rgba(148,163,184,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();

      const drawThreshold = (value: number, color: string, dash: number[]): void => {
        const y = mid - Math.min(1, value / full) * scale;
        ctx.save();
        ctx.setLineDash(dash);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
        ctx.restore();
      };
      drawThreshold(thresholds.current.openLevel, "rgba(34,197,94,0.45)", [4, 4]);
      drawThreshold(thresholds.current.closeLevel, "rgba(148,163,184,0.28)", [2, 5]);

      const data = samples.current;
      if (data.length < 2) return;

      const step = width / 240;
      const start = Math.max(0, data.length - 240);
      const visible = data.slice(start);

      // Received: a filled area above the line, brighter while the squelch is
      // open so a real transmission is distinguishable from background hiss.
      const rxGradient = ctx.createLinearGradient(0, 0, 0, mid);
      rxGradient.addColorStop(0, "rgba(34,197,94,0.55)");
      rxGradient.addColorStop(1, "rgba(34,197,94,0.06)");

      const txGradient = ctx.createLinearGradient(0, mid, 0, height);
      txGradient.addColorStop(0, "rgba(245,158,11,0.06)");
      txGradient.addColorStop(1, "rgba(245,158,11,0.55)");

      const area = (pick: (l: Levels) => number, up: boolean, fill: CanvasGradient): void => {
        ctx.beginPath();
        ctx.moveTo(0, mid);
        visible.forEach((sample, i) => {
          const value = Math.min(1, pick(sample) / full);
          const y = up ? mid - value * scale : mid + value * scale;
          ctx.lineTo(i * step, y);
        });
        ctx.lineTo((visible.length - 1) * step, mid);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };

      area((l) => l.rx, true, rxGradient);
      area((l) => l.tx, false, txGradient);

      // The open-squelch stripe: where the box decided somebody was talking.
      ctx.fillStyle = "rgba(34,197,94,0.85)";
      visible.forEach((sample, i) => {
        if (sample.receiving) ctx.fillRect(i * step, mid - 1.5, Math.max(1, step), 3);
      });
      ctx.fillStyle = "rgba(245,158,11,0.9)";
      visible.forEach((sample, i) => {
        if (sample.transmitting) ctx.fillRect(i * step, mid - 1.5, Math.max(1, step), 3);
      });

      // The leading edge, so the eye has something to follow.
      const last = visible[visible.length - 1]!;
      const x = (visible.length - 1) * step;
      const y = mid - Math.min(1, last.rx / full) * scale;
      ctx.fillStyle = last.receiving ? "#22c55e" : "rgba(148,163,184,0.5)";
      ctx.beginPath();
      ctx.arc(x, y, last.receiving ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
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
      </div>
    </div>
  );
}
