import { useEffect, useRef } from "react";
import type { Levels } from "../lib/useGateway";

/**
 * Level meters with a peak-hold marker.
 *
 * The DOM is written directly from the level stream rather than through state:
 * these update eight times a second and are the one part of the console that
 * genuinely needs to. Peak-hold is there because a transient clip is invisible
 * on a bar that only shows "now", and clipping is the most common reason a
 * transmission comes out unintelligible.
 */
export function Meters({ subscribe }: { subscribe: (fn: (l: Levels) => void) => () => void }) {
  const rxFill = useRef<HTMLDivElement>(null);
  const txFill = useRef<HTMLDivElement>(null);
  const rxPeak = useRef<HTMLDivElement>(null);
  const txPeak = useRef<HTMLDivElement>(null);
  const rxValue = useRef<HTMLDivElement>(null);
  const txValue = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const peaks = { rx: 0, tx: 0 };
    const decay = setInterval(() => {
      peaks.rx = Math.max(0, peaks.rx - 0.02);
      peaks.tx = Math.max(0, peaks.tx - 0.02);
    }, 400);

    const unsubscribe = subscribe((levels) => {
      const paint = (
        value: number,
        peak: number,
        fill: HTMLDivElement | null,
        marker: HTMLDivElement | null,
        label: HTMLDivElement | null,
        hot: string,
        normal: string,
      ): void => {
        const percent = Math.min(100, (value / 0.65) * 100);
        if (fill) {
          fill.style.width = `${percent}%`;
          // Red above -3 dBFS-ish: the point where a radio's audio stage starts
          // distorting rather than getting louder.
          fill.style.backgroundColor = value > 0.55 ? "#ef4444" : value > 0.3 ? hot : normal;
        }
        if (marker) marker.style.left = `${Math.min(99, (peak / 0.65) * 100)}%`;
        if (label) label.textContent = value > 0.002 ? `${Math.round(percent)}%` : "—";
      };

      peaks.rx = Math.max(peaks.rx, levels.rx);
      peaks.tx = Math.max(peaks.tx, levels.tx);
      paint(levels.rx, peaks.rx, rxFill.current, rxPeak.current, rxValue.current, "#4ade80", "#22c55e");
      paint(levels.tx, peaks.tx, txFill.current, txPeak.current, txValue.current, "#fbbf24", "#f59e0b");
    });

    return () => {
      clearInterval(decay);
      unsubscribe();
    };
  }, [subscribe]);

  return (
    <div className="meters">
      <div className="meter-row">
        <div className="meter-label">IN</div>
        <div className="meter">
          <div className="meter-fill" ref={rxFill} style={{ width: 0, backgroundColor: "#22c55e" }} />
          <div className="meter-peak" ref={rxPeak} style={{ left: 0 }} />
        </div>
        <div className="meter-value" ref={rxValue}>
          —
        </div>
      </div>
      <div className="meter-row">
        <div className="meter-label">OUT</div>
        <div className="meter">
          <div className="meter-fill" ref={txFill} style={{ width: 0, backgroundColor: "#f59e0b" }} />
          <div className="meter-peak" ref={txPeak} style={{ left: 0 }} />
        </div>
        <div className="meter-value" ref={txValue}>
          —
        </div>
      </div>
    </div>
  );
}
