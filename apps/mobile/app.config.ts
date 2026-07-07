import type { ExpoConfig } from "expo/config";
import { withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";
import * as fs from "fs";
import * as path from "path";

// FCM credentials for remote push (closed-app incident alarms). Drop the
// Firebase console's google-services.json next to this file — without it
// getExpoPushTokenAsync fails on Android and no push token is ever registered.
const googleServicesJson = path.resolve(__dirname, "google-services.json");
const hasGoogleServices = fs.existsSync(googleServicesJson);

// The tracking notification runs as a notifee foreground service (it keeps the
// GPS alive in the background). Android 14+ refuses to start a service that
// uses location unless its manifest entry declares foregroundServiceType.
// Notifee's own library manifest declares the service as shortService only, so
// the attribute must be replaced (tools:replace) with a superset including
// location — otherwise startForeground crashes with "foregroundServiceType …
// is not a subset of foregroundServiceType attribute".
const withNotifeeLocationForegroundService: ConfigPlugin = (expoConfig) =>
  withAndroidManifest(expoConfig, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$ = { ...manifest.$, "xmlns:tools": "http://schemas.android.com/tools" };
    const application = manifest.application?.[0];
    if (application) {
      application.service = application.service ?? [];
      const name = "app.notifee.core.ForegroundService";
      let service = application.service.find((s) => s.$?.["android:name"] === name);
      if (!service) {
        service = { $: { "android:name": name } };
        application.service.push(service);
      }
      service.$["android:foregroundServiceType"] = "shortService|location";
      (service.$ as Record<string, string>)["tools:replace"] = "android:foregroundServiceType";
    }
    return mod;
  });

// @notifee/react-native ships its native artifact in a local Maven repo inside
// the package; register it so Gradle can resolve app.notifee:core.
const notifeeMavenRepo = path.resolve(__dirname, "../../node_modules/@notifee/react-native/android/libs");

// Single source of truth for the user-facing app version: apps/mobile/package.json.
// Bump it (and tag a release build) with `npm run release:mobile [patch|minor|major]`.
const appVersion = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string }
).version;

const config: ExpoConfig = {
  name: "Paramedic Event App",
  slug: "paramedic-event-app",
  version: appVersion,
  updates: {
    url: "https://u.expo.dev/ffe5d9fa-a192-4b34-be11-5a43598959c3",
  },
  runtimeVersion: "0.5.0",
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
    ...(hasGoogleServices ? { googleServicesFile: "./google-services.json" } : {}),
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
      "USE_FULL_SCREEN_INTENT",
      "WAKE_LOCK",
      // Required for the one-tap "exempt from battery optimization" prompt
      // (android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) to appear.
      // Dropped silently when a prebuild regenerated the manifest from config.
      "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
      // Lists the app in the system "Do Not Disturb access" screen so the
      // incident-alarm channel's bypassDnd flag can actually be honored.
      "ACCESS_NOTIFICATION_POLICY",
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
    [
      "expo-location",
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
        locationAlwaysAndWhenInUsePermission:
          "Allow Paramedic Event App to share your location with event command while you are on duty.",
        locationAlwaysPermission:
          "Allow Paramedic Event App to share your location with event command while you are on duty.",
        locationWhenInUsePermission:
          "Allow Paramedic Event App to use your location while reporting incidents and viewing the event map.",
      },
    ],
    "@maplibre/maplibre-react-native",
    [
      "expo-notifications",
      {
        // Bundled into android res/raw — referenced by the incident alarm channel.
        sounds: ["./assets/sounds/incident_alarm.wav"],
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          extraMavenRepos: [notifeeMavenRepo],
        },
      },
    ],
    withNotifeeLocationForegroundService,
  ],
  extra: {
    eas: {
      projectId: "ffe5d9fa-a192-4b34-be11-5a43598959c3",
    },
    mapyApiKey: process.env.MAPY_API_KEY ?? process.env.EXPO_PUBLIC_MAPY_API_KEY ?? "",
  },
};

export default config;
