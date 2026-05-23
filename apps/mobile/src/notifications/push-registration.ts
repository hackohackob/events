import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { apiFetch } from "../ui/api-client";

/**
 * Request notification permissions and register the Expo push token
 * with the backend. Call this once after the user has joined an event.
 */
export async function registerPushToken(): Promise<void> {
  // Physical device required for push tokens
  const isPhysicalDevice =
    Constants.executionEnvironment === "storeClient" ||
    Constants.executionEnvironment === "bare";

  // On iOS we need explicit permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    // User denied — silently skip
    return;
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    });
    token = result.data;
  } catch {
    // Simulators or missing project ID — skip
    return;
  }

  // Configure Android channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#22c55e",
    });
  }

  // Register with backend
  try {
    await apiFetch("/notifications/token", {
      method: "POST",
      body: JSON.stringify({
        token,
        platform: "expo",
        deviceId: Constants.deviceName ?? undefined,
      }),
    });
  } catch {
    // Non-critical — ignore
  }
}
