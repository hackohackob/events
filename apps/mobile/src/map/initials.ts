/**
 * Two-letter medic badges for the map dots.
 *
 * "Ivan Ivanov" and "Iliya Iotov" both reduce to "II", which on a busy map is
 * two identical dots and no way to tell who is who. So the initials for a whole
 * roster are assigned together: everyone gets their natural initials unless
 * those are already taken, in which case they walk down a list of fallbacks
 * (later letters of the surname, then of the given name) until they land on
 * something free.
 */

/** The natural, un-disambiguated badge for a name. */
export function baseInitials(label: string): string {
  const words = splitWords(label);
  if (words.length >= 2) return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "PM";
}

function splitWords(label: string): string[] {
  return (label ?? "")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
}

/**
 * Badge candidates for one name, best first.
 *
 * For "Ivan Ivanov": II, Iv, Ia, In (first initial + successive surname
 * letters), then vI, aI, nI (successive given-name letters + surname initial).
 * Everything after that is the base with a digit, which never collides.
 */
function candidates(label: string): string[] {
  const words = splitWords(label);
  const out: string[] = [];
  const push = (value: string) => {
    const v = value.toUpperCase();
    if (v.length === 2 && !out.includes(v)) out.push(v);
  };

  if (words.length >= 2) {
    const [first, second] = words;
    for (let i = 0; i < second.length; i += 1) push(first.charAt(0) + second.charAt(i));
    for (let i = 1; i < first.length; i += 1) push(first.charAt(i) + second.charAt(0));
  } else if (words.length === 1) {
    const only = words[0];
    for (let i = 1; i < only.length; i += 1) push(only.charAt(0) + only.charAt(i));
    for (let i = 1; i < only.length; i += 1) push(only.charAt(i) + only.charAt(0));
  }

  if (out.length === 0) out.push(baseInitials(label));
  // Numbered last resort — with 9 slots a real roster can never exhaust it.
  const base = out[0];
  for (let n = 2; n <= 9; n += 1) out.push(`${base.charAt(0)}${n}`);
  return out;
}

/**
 * Resolve a whole roster at once. Entries are processed in a stable order (by
 * id) rather than in list order, so a badge doesn't jump between two people as
 * markers reorder on the map — only joining/leaving can shift an assignment.
 */
export function assignUniqueInitials(
  entries: Array<{ id: string; label: string }>,
): Record<string, string> {
  const ordered = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = new Set<string>();
  const out: Record<string, string> = {};

  for (const { id, label } of ordered) {
    const options = candidates(label);
    const pick = options.find((option) => !taken.has(option)) ?? options[0];
    taken.add(pick);
    out[id] = pick;
  }
  return out;
}
