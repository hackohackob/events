// Gesture handler must be imported first (before any other RN code) so its
// native module is initialized for @gorhom/bottom-sheet and reanimated.
import "react-native-gesture-handler";

// Background task definitions must be imported before registerRootComponent
// so the native side can find handlers when waking a killed app.
import "./src/location/location-tracker";
// Data-only push handler — raises the looping incident alarm when the app is
// backgrounded/killed.
import "./src/notifications/background-push";

// Notification action handlers (Report incident / Stop tracking) must be
// registered at module load so taps work even when the app was killed.
import { registerNotificationHandlers } from "./src/notifications/foreground-notification";
registerNotificationHandlers();

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
