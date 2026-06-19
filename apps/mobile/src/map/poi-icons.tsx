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
