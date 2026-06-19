import {
  Hospital,
  Ambulance,
  Cross,
  Mountain,
  Droplet,
  Apple,
  Toilet,
  Shirt,
  SquareParking,
  TriangleAlert,
  Construction,
  Wrench,
  Flag,
  FlagTriangleRight,
  Trophy,
  Tent,
  Star,
  MapPin,
  Camera,
  Phone,
  Flashlight,
  type LucideIcon,
} from 'lucide-react'

/**
 * Vector icon for each POI type — shared by the map markers, the create
 * wizard, and the assignment list. Kept in sync with the mobile registry in
 * `apps/mobile/src/map/poi-icons.tsx` (same icon concepts, MaterialCommunityIcons
 * names there).
 */
const POI_TYPE_ICON: Record<string, LucideIcon> = {
  'base-medical-camp': Hospital,
  ambulance: Ambulance,
  'medical-point': Cross,
  mrs: Mountain,
  'water-point': Droplet,
  'food-point': Apple,
  wc: Toilet,
  wardrobe: Shirt,
  parking: SquareParking,
  danger: TriangleAlert,
  'road-crossing': Construction,
  mechanical: Wrench,
  marshal: Flag,
  checkpoint: FlagTriangleRight,
  finish: Trophy,
  shelter: Tent,
  custom: Star,
}

/**
 * Selectable glyphs for a "custom" point of interest. The stored value is the
 * stable `key`, not an emoji — so it renders identically on web and mobile.
 */
export const CUSTOM_POI_ICON_OPTIONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'danger', label: 'Danger', Icon: TriangleAlert },
  { key: 'star', label: 'Star', Icon: Star },
  { key: 'flag', label: 'Flag', Icon: Flag },
  { key: 'pin', label: 'Pin', Icon: MapPin },
  { key: 'finish', label: 'Finish', Icon: Trophy },
  { key: 'camp', label: 'Camp', Icon: Tent },
  { key: 'viewpoint', label: 'Viewpoint', Icon: Camera },
  { key: 'obstacle', label: 'Obstacle', Icon: Construction },
  { key: 'contact', label: 'Contact', Icon: Phone },
  { key: 'search', label: 'Search point', Icon: Flashlight },
  { key: 'rockfall', label: 'Rockfall', Icon: Mountain },
  { key: 'water', label: 'Water', Icon: Droplet },
]

const CUSTOM_KEY_ICON: Record<string, LucideIcon> = Object.fromEntries(
  CUSTOM_POI_ICON_OPTIONS.map((o) => [o.key, o.Icon]),
)

/**
 * Legacy POIs stored an emoji in `poi.icon`. Map the old emoji set onto the new
 * keyed icons so existing points still render as vectors.
 */
const LEGACY_EMOJI_TO_KEY: Record<string, string> = {
  '⚠️': 'danger',
  '⭐': 'star',
  '🚩': 'flag',
  '📍': 'pin',
  '🏁': 'finish',
  '⛺': 'camp',
  '📷': 'viewpoint',
  '🚧': 'obstacle',
  '☎️': 'contact',
  '🔦': 'search',
  '🪨': 'rockfall',
  '💧': 'water',
}

function resolveIcon(type?: string, icon?: string | null): LucideIcon | null {
  if (icon) {
    if (CUSTOM_KEY_ICON[icon]) return CUSTOM_KEY_ICON[icon]
    const legacy = LEGACY_EMOJI_TO_KEY[icon]
    if (legacy && CUSTOM_KEY_ICON[legacy]) return CUSTOM_KEY_ICON[legacy]
    return null // unknown custom glyph — caller falls back to raw text
  }
  return POI_TYPE_ICON[type ?? ''] ?? Star
}

interface PoiIconProps {
  type?: string
  /** Per-point custom glyph (stable key, or a legacy emoji). */
  icon?: string | null
  size?: number
  color?: string
  strokeWidth?: number
}

/**
 * Renders the right vector icon for a POI. Falls back to the raw `icon` string
 * (e.g. an unrecognised legacy emoji) when no vector match exists.
 */
export function PoiIcon({ type, icon, size = 16, color = 'currentColor', strokeWidth = 2.4 }: PoiIconProps) {
  const Resolved = resolveIcon(type, icon)
  if (!Resolved) {
    return <span style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>
  }
  return <Resolved size={size} color={color} strokeWidth={strokeWidth} />
}
