import Constants from "expo-constants";

function getExpoHost(): string | null {
  const hostUriFromConfig = Constants.expoConfig?.hostUri;
  if (typeof hostUriFromConfig === "string" && hostUriFromConfig.length > 0) {
    return hostUriFromConfig.split(":")[0] ?? null;
  }

  const expoGoHost = (Constants as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2
    ?.extra?.expoGo?.debuggerHost;
  if (typeof expoGoHost === "string" && expoGoHost.length > 0) {
    return expoGoHost.split(":")[0] ?? null;
  }

  return null;
}

export function resolveLocalhostUrl(url: string): string {
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) {
    return url;
  }

  const host = getExpoHost();
  if (!host) {
    return url;
  }

  return url.replace("localhost", host).replace("127.0.0.1", host);
}
