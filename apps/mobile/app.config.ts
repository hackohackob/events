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
  // Display name is Extreme Medics; the slug stays untouched because it pins the
  // existing EAS project (updates URL + projectId above/below).
  name: "Extreme Medics",
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
    bundleIdentifier: "com.academyfirstaid.extrememedics",
    infoPlist: {
      // "location" comes from the expo-location plugin; "remote-notification"
      // lets the data-only incident pushes wake the background-push task
      // (backend must send them with content-available for iOS).
      UIBackgroundModes: ["location", "remote-notification"],
      // Standard HTTPS-only exemption — skips the export-compliance
      // questionnaire on every App Store Connect upload.
      ITSAppUsesNonExemptEncryption: false,
      // App Review (guideline 5.1.1(ii)) rejected the Expo default purpose
      // strings for being generic. Every string below must say what the data is
      // used for AND give a concrete example. The camera/photos/microphone ones
      // are ALSO set as props on the expo-image-picker / expo-audio plugins
      // below, because an auto-applied config plugin overwrites whatever is
      // here — keep the two copies in sync.
      NSPhotoLibraryAddUsageDescription:
        "Extreme Medics saves photos you take of an incident back to your photo library, so you keep your own copy of the scene you documented.",
    },
  },
  android: {
    package: "com.academyfirstaid.extrememedics",
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
          "Extreme Medics shares your location with event command while you are on duty — for example, so the dispatcher can send the nearest medic to a collapsed runner. Location is also used while the app is in the background so you stay on the map with the phone locked in your pocket.",
        locationAlwaysPermission:
          "Extreme Medics keeps sharing your location with event command in the background while your shift is active — for example, so the dispatcher can still route you to a casualty while your phone is locked in your pocket.",
        locationWhenInUsePermission:
          "Extreme Medics uses your location to place you on the event map and to attach your position to an incident you report — for example, so the ambulance crew knows exactly where the injured runner is.",
      },
    ],
    [
      "expo-image-picker",
      {
        // Mirrors ios.infoPlist above — the plugin's defaults ("Allow $(PRODUCT_NAME)
        // to access your camera") are what App Review rejected.
        cameraPermission:
          "Extreme Medics uses the camera so you can photograph an incident scene — for example, a picture of an injured runner's position that event command and the receiving hospital can see before the ambulance arrives.",
        photosPermission:
          "Extreme Medics needs your photo library so you can attach an existing photo to an incident report or a team chat message — for example, a picture of a hazard on the track you took earlier.",
        microphonePermission:
          "Extreme Medics uses the microphone for push-to-talk radio and voice notes — for example, dictating a casualty's condition to event command while your hands are busy treating them.",
      },
    ],
    [
      "expo-audio",
      {
        microphonePermission:
          "Extreme Medics uses the microphone for push-to-talk radio and voice notes — for example, dictating a casualty's condition to event command while your hands are busy treating them.",
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
