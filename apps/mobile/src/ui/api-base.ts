import { resolveLocalhostUrl } from "./runtime-host";

/**
 * The API root, e.g. `https://events-api.hackohackob.com/api`.
 *
 * Its own module so the connectivity gate can probe the server without
 * importing api-client, which itself reports into the connectivity gate.
 */
export const API_BASE_URL = resolveLocalhostUrl(
  process.env.EXPO_PUBLIC_API_URL ?? "https://events-api.hackohackob.com/api",
);
