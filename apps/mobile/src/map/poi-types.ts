/**
 * Point types offered when placing or editing a POI in the field. Shared by the
 * new-point and edit sheets so both offer exactly the same board vocabulary.
 */
export const POI_TYPES: Array<{ id: string; label: string; icon: string; color: string }> = [
  { id: "base-medical-camp", label: "Base Camp", icon: "🏥", color: "#ef4444" },
  { id: "ambulance", label: "Ambulance", icon: "🚑", color: "#ef4444" },
  { id: "medical-point", label: "Medical", icon: "✚", color: "#ef4444" },
  { id: "water-point", label: "Water", icon: "💧", color: "#3b82f6" },
  { id: "wc", label: "WC", icon: "🚻", color: "#8b5cf6" },
  { id: "wardrobe", label: "Wardrobe", icon: "👕", color: "#f97316" },
  { id: "parking", label: "Parking", icon: "🅿️", color: "#f59e0b" },
  { id: "mrs", label: "Mountain Rescue", icon: "⛰️", color: "#0ea5e9" },
  { id: "custom", label: "Other", icon: "★", color: "#94a3b8" },
];
