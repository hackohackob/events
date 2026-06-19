import type { IncidentCategory } from "@events/contracts";

/** A selectable course track / discipline, resolved from the event's tracks. */
export interface TrackChoice {
  id: string;
  label: string;
  color: string;
}

const TRACK_COLORS = ["var(--track-10k)", "var(--track-21k)", "var(--track-42k)", "var(--track-100k)"];

/** Cycle the brand track colours for tracks that don't define their own. */
export function trackColor(index: number, provided?: string): string {
  return provided || TRACK_COLORS[index % TRACK_COLORS.length];
}

export interface RunnerProfile {
  runnerName: string | null;
  bibNumber: string | null;
  phone: string | null;
  selectedTrackId: string | null;
  selectedTrackLabel: string | null;
  selectedTrackColor: string | null;
}

/** Event identity + selectable tracks, fetched from the API on open. */
export interface EventInfo {
  id: string;
  title: string;
  tracks: TrackChoice[];
}

/** Optional medical / ICE profile, kept on-device and attached to any SOS. */
export interface MedicalInfo {
  bloodType: string;
  allergies: string;
  medications: string;
  conditions: string;
  emergencyName: string;
  emergencyPhone: string;
}

export const BLOOD_TYPES = ["", "A+", "A−", "B+", "B−", "AB+", "AB−", "0+", "0−"];

/** True when the profile has any field filled. */
export function hasMedicalInfo(m: MedicalInfo | null): boolean {
  return !!m && Object.values(m).some((v) => v.trim() !== "");
}

/** One-line summary for attaching to an incident report. */
export function medicalSummary(m: MedicalInfo | null): string {
  if (!hasMedicalInfo(m)) return "";
  const parts: string[] = [];
  if (m!.bloodType) parts.push(`Blood ${m!.bloodType}`);
  if (m!.allergies) parts.push(`Allergies: ${m!.allergies}`);
  if (m!.medications) parts.push(`Meds: ${m!.medications}`);
  if (m!.conditions) parts.push(`Conditions: ${m!.conditions}`);
  if (m!.emergencyName || m!.emergencyPhone)
    parts.push(`ICE: ${m!.emergencyName} ${m!.emergencyPhone}`.trim());
  return parts.join(" · ");
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
