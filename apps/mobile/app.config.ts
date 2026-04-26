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
    package: "com.a.atanasov.paramediceventapp",
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
      },
    },
  },
  extra: {
    eas: {
      projectId: "ffe5d9fa-a192-4b34-be11-5a43598959c3",
    },
    mapyApiKey: process.env.MAPY_API_KEY ?? process.env.EXPO_PUBLIC_MAPY_API_KEY ?? "",
  },
};

export default config;
