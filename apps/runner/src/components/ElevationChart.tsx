import { useEffect, useRef, useState } from "react";
import { poiVisual } from "../map/RunnerMap";

export interface ElevSample {
  km: number;
  ele: number;
}

/** A POI on (or near) the track, already snapped to km-along. */
export interface ElevPoi {
  km: number;
  type: string;
  name?: string;
}

/**
 * Real elevation profile. Full-bleed width (measures its container), draggable
 * scrubber that reports the scrubbed km, the runner's position, and any medics
 * that are on (or within 200 m of) the track.
 */
export function ElevationChart({
  samples,
  totalKm,
  runnerKm,
  medicsKm = [],
  pois = [],
  height = 130,
  onScrub,
}: {
  samples: ElevSample[];
  totalKm: number;
  runnerKm: number | null;
  medicsKm?: number[];
  pois?: ElevPoi[];
  height?: number;
  onScrub?: (km: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [scrub, setScrub] = useState<{ km: number; ele: number; x: number } | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(120, entries[0].contentRect.width)));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const padTop = 10;
  const padBottom = 4;
  if (samples.length < 2 || totalKm <= 0) {
    return <div ref={wrapRef} style={{ width: "100%", height: H, borderRadius: 12, background: "#0E1A28" }} />;
  }

  const eles = samples.map((s) => s.ele);
  const minE = Math.min(...eles);
  const maxE = Math.max(...eles, minE + 1);
  const xOf = (km: number) => (km / totalKm) * w;
  const yOf = (ele: number) => H - padBottom - ((ele - minE) / (maxE - minE)) * (H - padTop - padBottom);

  const line = samples.map((s, i) => `${i === 0 ? "M" : "L"}${xOf(s.km).toFixed(1)} ${yOf(s.ele).toFixed(1)}`).join(" ");
  const area = `${line} L ${w} ${H} L 0 ${H} Z`;

  const eleAtKm = (km: number) => {
    // nearest sample (samples are dense enough for visual)
    let lo = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i].km <= km) lo = i;
    return samples[Math.min(lo, samples.length - 1)].ele;
  };

  function handlePointer(clientX: number) {
    const rect = wrapRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(w, clientX - rect.left));
    const km = (x / w) * totalKm;
    setScrub({ km, ele: eleAtKm(km), x });
    onScrub?.(km);
  }
  function endScrub() {
    setScrub(null);
    onScrub?.(null);
  }

  const runnerX = runnerKm != null ? xOf(Math.min(runnerKm, totalKm)) : null;

  return (
    <div ref={wrapRef} style={{ width: "100%", position: "relative", touchAction: "none" }}>
      <svg
        width={w}
        height={H}
        style={{ borderRadius: 12, background: "#0E1A28", border: "1px solid rgba(255,255,255,0.06)", display: "block" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handlePointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 || scrub) handlePointer(e.clientX);
        }}
        onPointerUp={endScrub}
        onPointerLeave={() => scrub && endScrub()}
      >
        <defs>
          <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2BE3A0" stopOpacity="0.45" />
            <stop offset="1" stopColor="#2BE3A0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#elevFill)" />
        <path d={line} fill="none" stroke="#2BE3A0" strokeWidth="2.4" />

        {/* POIs on/near the track — small glyph badges, not interactive (must
            never intercept the scrub gesture, which is handled by the parent
            <svg>'s pointer capture regardless of what's underneath). */}
        {pois.map((p, i) => {
          const v = poiVisual(p.type);
          if (!v) return null;
          const cx = xOf(Math.min(p.km, totalKm));
          const cy = yOf(eleAtKm(p.km));
          return (
            <g key={i} style={{ pointerEvents: "none" }}>
              <circle cx={cx} cy={cy} r="9" fill={v.bg} stroke="#0E1A28" strokeWidth="1.6" />
              <text x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="central" fontSize="10">
                {v.glyph}
              </text>
              {p.name && <title>{p.name}</title>}
            </g>
          );
        })}

        {/* Medics on/near the track */}
        {medicsKm.map((km, i) => (
          <g key={i}>
            <circle cx={xOf(Math.min(km, totalKm))} cy={yOf(eleAtKm(km))} r="6" fill="#18B883" stroke="#fff" strokeWidth="2" />
          </g>
        ))}

        {/* Runner */}
        {runnerX != null && (
          <>
            <line x1={runnerX} y1={2} x2={runnerX} y2={H} stroke="#FFD23F" strokeWidth="1.6" strokeDasharray="3 3" />
            <circle cx={runnerX} cy={yOf(eleAtKm(runnerKm!))} r="5" fill="#2E9BFF" stroke="#fff" strokeWidth="2" />
          </>
        )}

        {/* Scrubber */}
        {scrub && (
          <>
            <line x1={scrub.x} y1={0} x2={scrub.x} y2={H} stroke="#F2F6FB" strokeWidth="1.4" />
            <circle cx={scrub.x} cy={yOf(scrub.ele)} r="5" fill="#fff" />
          </>
        )}
      </svg>

      {scrub && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: Math.max(4, Math.min(w - 120, scrub.x - 60)),
            pointerEvents: "none",
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-mid)",
            borderRadius: 8,
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {scrub.km.toFixed(1)} km · {Math.round(scrub.ele)} m
        </div>
      )}
    </div>
  );
}
