import { createSign } from "node:crypto";

/**
 * Zello `auth_token` minting.
 *
 * The token is an RS256 JWT signed with the account's own private key from the
 * Zello developer console — there is no token endpoint to call. Claim set and
 * key order below are exact: signing with a known key reproduces the developer
 * console's sample tokens byte-for-byte, which is how they were verified.
 */

const TTL_SECONDS = 60 * 60;

function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Sign a 1-hour developer token for `issuer` with the PEM-encoded private key. */
export function mintZelloToken(issuer: string, privateKeyPem: string, ttlSeconds = TTL_SECONDS): string {
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "RS256" }));
  const payload = base64url(
    JSON.stringify({ iss: issuer, exp: Math.floor(Date.now() / 1000) + ttlSeconds, azp: "dev" }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${base64url(signer.sign(privateKeyPem))}`;
}

/** Seconds until a JWT's `exp`, or 0 when it is unreadable/expired. */
export function tokenSecondsRemaining(token: string): number {
  try {
    const [, payload] = token.split(".");
    if (!payload) return 0;
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { exp?: number };
    if (!decoded.exp) return 0;
    return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
  } catch {
    return 0;
  }
}

/**
 * A ready-made token wins when present (lets an operator paste one from the
 * console); otherwise the issuer + private key pair mints a fresh one on every
 * connect, which sidesteps refresh-token bookkeeping entirely.
 */
export function resolveAuthToken(input: {
  devToken?: string;
  issuer?: string;
  privateKey?: string;
}): string | null {
  const dev = input.devToken?.trim();
  // A pasted token that has already expired is worse than useless — it makes
  // logon fail with a generic error. Fall through to signing in that case.
  if (dev && tokenSecondsRemaining(dev) > 60) return dev;
  const issuer = input.issuer?.trim();
  const privateKey = normalizePem(input.privateKey);
  if (issuer && privateKey) return mintZelloToken(issuer, privateKey);
  return dev || null;
}

/**
 * PEM pasted through a web form or an env var usually arrives with escaped or
 * stripped newlines. Rebuild the line structure so `crypto` accepts it.
 */
export function normalizePem(raw?: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const unescaped = value.replace(/\\n/g, "\n");
  if (unescaped.includes("\n")) return unescaped;
  const match = /^(-----BEGIN [A-Z ]+-----)(.*)(-----END [A-Z ]+-----)$/.exec(unescaped.replace(/\s+/g, " ").trim());
  if (!match) return unescaped;
  const body = match[2]!.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return [match[1], ...lines, match[3]].join("\n");
}
