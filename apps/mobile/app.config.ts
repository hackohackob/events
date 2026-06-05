import type { ExpoConfig } from "expo/config";
import * as path from "path";

// @notifee/react-native ships its native artifact in a local Maven repo inside
// the package; register it so Gradle can resolve app.notifee:core.
const notifeeMavenRepo = path.resolve(__dirname, "../../node_modules/@notifee/react-native/android/libs");

const config: ExpoConfig = {
  name: "Paramedic Event App",
  slug: "paramedic-event-app",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
    icon: "./assets/icon.png",
  },
  android: {
    package: "com.a.atanasov.paramediceventapp",
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
      "WAKE_LOCK",
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/icon-android.png",
      backgroundColor: "#030d1f",
    },
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
      },
    },
  },
  plugins: [
    "@maplibre/maplibre-react-native",
    [
      "expo-build-properties",
      {
        android: {
          extraMavenRepos: [notifeeMavenRepo],
        },
      },
    ],
  ],
  extra: {
    eas: {
      projectId: "ffe5d9fa-a192-4b34-be11-5a43598959c3",
    },
    mapyApiKey: process.env.MAPY_API_KEY ?? process.env.EXPO_PUBLIC_MAPY_API_KEY ?? "",
  },
};

export default config;
