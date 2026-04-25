import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Paramedic Event App",
  slug: "paramedic-event-app",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
  },
  android: {
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
  },
  extra: {
    mapyApiKey: process.env.MAPY_API_KEY ?? process.env.EXPO_PUBLIC_MAPY_API_KEY ?? "",
  },
};

export default config;
