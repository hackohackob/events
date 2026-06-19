/** Phone number the runner dials to reach Race Command (tel: link).
 *  Override per deployment with VITE_COMMAND_PHONE; falls back to 112. */
export const COMMAND_PHONE = (import.meta.env.VITE_COMMAND_PHONE as string) || "112";

/** Number SOS texts go to when data fails. Defaults to the command phone. */
export const COMMAND_SMS = (import.meta.env.VITE_COMMAND_SMS as string) || COMMAND_PHONE;

/** Build a prefilled SMS deep-link as an offline SOS fallback. */
export function buildSosSmsHref(fields: {
  category: string;
  name?: string;
  bib?: string;
  lat?: number;
  lng?: number;
  medical?: string;
}): string {
  const loc =
    fields.lat != null && fields.lng != null
      ? `${fields.lat.toFixed(5)},${fields.lng.toFixed(5)} https://maps.google.com/?q=${fields.lat},${fields.lng}`
      : "location unknown";
  const body = [
    `SOS ${fields.category.replace(/_/g, " ")}`,
    [fields.name, fields.bib && `bib ${fields.bib}`].filter(Boolean).join(" "),
    `Loc: ${loc}`,
    fields.medical,
  ]
    .filter(Boolean)
    .join(" | ");
  return `sms:${COMMAND_SMS}?body=${encodeURIComponent(body)}`;
}
