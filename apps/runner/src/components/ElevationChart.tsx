/**
 * Elevation profile chart. The track GeoJSON carries only ascent/descent totals
 * (not per-point elevation), so we synthesise a smooth, deterministic profile
 * from the totals for visualisation, then overlay the runner's snapped position.
 */
export function ElevationChart({
  totalKm,
  ascent,
  descent,
  runnerKm,
  height = 104,
}: {
  totalKm: number;
  ascent: number;
  descent: number;
  runnerKm: number | null;
  height?: number;
}) {
  const W = 320;
  const H = height;
  const N = 80;
  const span = Math.max(ascent, descent, 100);

  // Two-hump synthetic profile scaled to ascent/descent.
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const raw = Math.sin(f * Math.PI) * 0.7 + Math.sin(f * Math.PI * 3) * 0.3;
    const elev = Math.max(0, raw) * ascent - Math.max(0, -raw) * descent * 0.4;
    pts.push({ x: f * W, y: elev });
  }
  const min = Math.min(...pts.map((p) => p.y));
  const max = Math.max(...pts.map((p) => p.y), min + 1);
  const scaleY = (v: number) => H - 8 - ((v - min) / (max - min)) * (H - 20);

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${scaleY(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  void span;

  const runnerX = runnerKm != null && totalKm > 0 ? Math.min(1, runnerKm / totalKm) * W : null;
  const runnerY =
    runnerX != null ? scaleY(pts[Math.round((runnerX / W) * N)]?.y ?? 0) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ borderRadius: 12, background: "#0E1A28", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <defs>
        <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2BE3A0" stopOpacity="0.45" />
          <stop offset="1" stopColor="#2BE3A0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#elevFill)" />
      <path d={line} fill="none" stroke="#2BE3A0" strokeWidth="2.4" />
      {runnerX != null && (
        <>
          <line x1={runnerX} y1={4} x2={runnerX} y2={H} stroke="#FFD23F" strokeWidth="1.6" strokeDasharray="3 3" />
          <circle cx={runnerX} cy={runnerY ?? H / 2} r="5" fill="#2E9BFF" stroke="#fff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}
