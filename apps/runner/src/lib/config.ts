/** Build a prefilled SMS deep-link as an offline SOS fallback, addressed to
 *  the event's Command Center phone number (set by the organizer). Callers
 *  must only invoke this when a commandPhone exists — there is no generic
 *  fallback number, since call/SMS are hidden entirely when it's unset. */
export function buildSosSmsHref(
  commandPhone: string,
  fields: {
    category: string;
    name?: string;
    bib?: string;
    lat?: number;
    lng?: number;
    medical?: string;
  },
): string {
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
  return `sms:${commandPhone}?body=${encodeURIComponent(body)}`;
}
