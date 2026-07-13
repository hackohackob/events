import React from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";

type MciName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * Vector icon for each POI type. Kept in sync with the web registry in
 * `apps/web/src/lib/poi-icons.tsx` (same icon concepts, lucide-react names there).
 */
const POI_TYPE_ICON: Record<string, MciName> = {
  "base-medical-camp": "hospital-building",
  ambulance: "ambulance",
  "medical-point": "medical-bag",
  mrs: "terrain",
  "water-point": "water",
  "food-point": "food-apple",
  wc: "toilet",
  wardrobe: "tshirt-crew",
  parking: "parking",
  danger: "alert",
  "road-crossing": "traffic-cone",
  mechanical: "wrench",
  marshal: "flag",
  checkpoint: "flag-variant",
  finish: "trophy",
  shelter: "tent",
  custom: "star",
  marker: "map-marker",
};

/**
 * Selectable glyphs for a "custom" point of interest. The stored value is the
 * stable `key` — matched 1:1 with the web CUSTOM_POI_ICON_OPTIONS so a custom
 * POI placed on the dashboard renders the same icon here.
 */
const CUSTOM_KEY_ICON: Record<string, MciName> = {
  danger: "alert",
  star: "star",
  flag: "flag",
  pin: "map-marker",
  finish: "trophy",
  camp: "tent",
  viewpoint: "camera",
  obstacle: "traffic-cone",
  contact: "phone",
  search: "flashlight",
  rockfall: "image-filter-hdr",
  water: "water",
  "no-service": "signal-off",
  service: "signal",
  "descent-end": "elevation-decline",
  "climb-start": "elevation-rise",
  hotel: "bed",
  fuel: "gas-station",
};

/** Legacy POIs stored an emoji in `icon`; map the old set onto keyed icons. */
const LEGACY_EMOJI_TO_KEY: Record<string, string> = {
  "⚠️": "danger",
  "⭐": "star",
  "🚩": "flag",
  "📍": "pin",
  "🏁": "finish",
  "⛺": "camp",
  "📷": "viewpoint",
  "🚧": "obstacle",
  "☎️": "contact",
  "🔦": "search",
  "🪨": "rockfall",
  "💧": "water",
};

/**
 * Selectable custom glyphs, in display order. Keys & labels mirror the web
 * `CUSTOM_POI_ICON_OPTIONS` so the same choice renders identically everywhere.
 */
export const CUSTOM_POI_ICON_OPTIONS: { key: string; label: string; icon: MciName }[] = [
  { key: "danger", label: "Danger", icon: CUSTOM_KEY_ICON.danger },
  { key: "star", label: "Star", icon: CUSTOM_KEY_ICON.star },
  { key: "flag", label: "Flag", icon: CUSTOM_KEY_ICON.flag },
  { key: "pin", label: "Pin", icon: CUSTOM_KEY_ICON.pin },
  { key: "finish", label: "Finish", icon: CUSTOM_KEY_ICON.finish },
  { key: "camp", label: "Camp", icon: CUSTOM_KEY_ICON.camp },
  { key: "viewpoint", label: "Viewpoint", icon: CUSTOM_KEY_ICON.viewpoint },
  { key: "obstacle", label: "Obstacle", icon: CUSTOM_KEY_ICON.obstacle },
  { key: "contact", label: "Contact", icon: CUSTOM_KEY_ICON.contact },
  { key: "search", label: "Search point", icon: CUSTOM_KEY_ICON.search },
  { key: "rockfall", label: "Rockfall", icon: CUSTOM_KEY_ICON.rockfall },
  { key: "water", label: "Water", icon: CUSTOM_KEY_ICON.water },
  { key: "no-service", label: "No signal", icon: CUSTOM_KEY_ICON["no-service"] },
  { key: "service", label: "Signal here", icon: CUSTOM_KEY_ICON.service },
  { key: "descent-end", label: "Descent ends", icon: CUSTOM_KEY_ICON["descent-end"] },
  { key: "climb-start", label: "Climb starts", icon: CUSTOM_KEY_ICON["climb-start"] },
  { key: "hotel", label: "Hotel", icon: CUSTOM_KEY_ICON.hotel },
  { key: "fuel", label: "Fuel", icon: CUSTOM_KEY_ICON.fuel },
];

function resolveName(type?: string, icon?: string | null): MciName {
  if (icon) {
    if (CUSTOM_KEY_ICON[icon]) return CUSTOM_KEY_ICON[icon];
    const legacy = LEGACY_EMOJI_TO_KEY[icon];
    if (legacy && CUSTOM_KEY_ICON[legacy]) return CUSTOM_KEY_ICON[legacy];
  }
  return POI_TYPE_ICON[type ?? ""] ?? "map-marker";
}

interface PoiIconProps {
  type?: string;
  /** Per-point custom glyph (stable key, or a legacy emoji). */
  icon?: string | null;
  size?: number;
  color?: string;
}

/** Renders the right MaterialCommunityIcons glyph for a POI. */
export function PoiIcon({ type, icon, size = 16, color = "#ffffff" }: PoiIconProps) {
  return <MaterialCommunityIcons name={resolveName(type, icon)} size={size} color={color} />;
}
