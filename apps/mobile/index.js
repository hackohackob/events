// Gesture handler must be imported first (before any other RN code) so its
// native module is initialized for @gorhom/bottom-sheet and reanimated.
import "react-native-gesture-handler";

// Configures NetInfo (disables its Google reachability check) — must run before
// any other module creates NetInfo state, or that state's listeners are wiped.
import "./src/offline/connectivity";

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

// Android Auto bridge. Installed at module load, not from a component, because
// the car service can start this JS runtime with no UI at all (app swiped away,
// helmet on, bike moving). It is inert on iOS and in builds without the car app,
// and stays inert until Android Auto actually connects.
//
// Switched OFF for now (not in use). Everything is kept — flip this to true to
// bring the car screen back; no other change is needed.
const ANDROID_AUTO_ENABLED = false;
import { startCarBridge } from "./src/car/car-bridge";
if (ANDROID_AUTO_ENABLED) startCarBridge();

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
