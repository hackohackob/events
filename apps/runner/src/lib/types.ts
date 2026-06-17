import type { IncidentCategory } from "@events/contracts";

/** The four design track options. `id` doubles as the localStorage value. */
export type TrackKey = "10K" | "21K" | "42K" | "100K";

export interface TrackOption {
  key: TrackKey;
  distanceKm: number;
  color: string;
  /** i18n key for the sub-label. */
  subKey: string;
}

export const TRACK_OPTIONS: TrackOption[] = [
  { key: "10K", distanceKm: 10, color: "var(--track-10k)", subKey: "track.coastal" },
  { key: "21K", distanceKm: 21, color: "var(--track-21k)", subKey: "track.half" },
  { key: "42K", distanceKm: 42, color: "var(--track-42k)", subKey: "track.marathon" },
  { key: "100K", distanceKm: 100, color: "var(--track-100k)", subKey: "track.ultra" },
];

export interface RunnerProfile {
  runnerName: string | null;
  bibNumber: string | null;
  phone: string | null;
  selectedTrack: TrackKey | null;
}

export interface IncidentCategoryDef {
  category: IncidentCategory;
  labelKey: string;
  subKey?: string;
  /** CSS colour token for the icon background. */
  color: string;
  /** Emoji glyph (stand-in for the design's custom SVGs). */
  glyph: string;
}

/** The 2×2 primary grid from the design. */
export const PRIMARY_CATEGORIES: IncidentCategoryDef[] = [
  { category: "severe_injury", labelKey: "report.severe", subKey: "report.severe.sub", color: "var(--critical)", glyph: "🩸" },
  { category: "chest_pain", labelKey: "report.chest", subKey: "report.chest.sub", color: "var(--urgent)", glyph: "💢" },
  { category: "collapse", labelKey: "report.collapse", subKey: "report.collapse.sub", color: "var(--critical-dark)", glyph: "🆘" },
  { category: "minor_injury", labelKey: "report.minor", subKey: "report.minor.sub", color: "var(--caution)", glyph: "🩹" },
];

/** Extra categories ("cover everything that could happen"). */
export const EXTRA_CATEGORIES: IncidentCategoryDef[] = [
  { category: "heat_illness", labelKey: "cat.heat_illness", color: "var(--urgent)", glyph: "🌡️" },
  { category: "dehydration", labelKey: "cat.dehydration", color: "var(--caution)", glyph: "💧" },
  { category: "hypothermia", labelKey: "cat.hypothermia", color: "var(--live-gps)", glyph: "❄️" },
  { category: "allergic_reaction", labelKey: "cat.allergic_reaction", color: "var(--urgent)", glyph: "🐝" },
  { category: "seizure", labelKey: "cat.seizure", color: "var(--critical)", glyph: "⚡" },
  { category: "fall_trauma", labelKey: "cat.fall_trauma", color: "var(--critical-dark)", glyph: "🧗" },
  { category: "lost_disoriented", labelKey: "cat.lost_disoriented", color: "var(--caution)", glyph: "🧭" },
  { category: "other", labelKey: "cat.other", color: "var(--text-muted)", glyph: "❓" },
];

export const ALL_CATEGORIES = [...PRIMARY_CATEGORIES, ...EXTRA_CATEGORIES];
