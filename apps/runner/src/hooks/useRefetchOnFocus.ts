import { useEffect, useRef } from "react";

/**
 * Re-run `onFocus` whenever the tab/app regains visibility — on a phone this
 * is almost always "the screen was locked and is now unlocked", so any data
 * fetched before the lock (tracks, POIs, event info) may be stale.
 */
export function useRefetchOnFocus(onFocus: () => void) {
  const cb = useRef(onFocus);
  cb.current = onFocus;

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") cb.current();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, []);
}
