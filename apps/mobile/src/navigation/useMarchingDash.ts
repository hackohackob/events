import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Shared "ant-march" ticker for animated dashed route lines.
 *
 * The layers used to run their own 130ms setInterval each — 8 native paint
 * updates per second PER LINE, around the clock, even with the screen locked
 * (the foreground service keeps JS alive). That kept the map's render loop and
 * the JS→native bridge permanently busy and was one of the measurable battery
 * drains. One slower cadence still reads as motion, and the ticker fully stops
 * while the app is backgrounded.
 */
const DASH_TICK_MS = 400;

export function useMarchingDash(sequenceLength: number): number {
  const [dashIndex, setDashIndex] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => setDashIndex((i) => (i + 1) % sequenceLength), DASH_TICK_MS);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") start();
      else stop();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [sequenceLength]);

  return dashIndex;
}
