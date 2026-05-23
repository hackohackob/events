// Background task definitions must be imported before registerRootComponent
// so the native side can find handlers when waking a killed app.
import "./src/location/location-tracker";

import { registerRootComponent } from "expo";
import App from "./src/App";

registerRootComponent(App);
