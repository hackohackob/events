import { useCallback, useEffect, useState } from "react";

type GateState = "checking" | "prompting" | "granted" | "denied" | "unsupported";

/**
 * Hard location gate: the runner app is a live-safety tool, so it must not start
 * without device location. Children render only once geolocation permission is
 * granted; otherwise a blocking screen explains why and offers a retry. In local
 * dev we bypass the gate so the app is usable without a real GPS fix.
 */
export function LocationGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>(import.meta.env.DEV ? "granted" : "checking");

  const request = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    setState("prompting");
    navigator.geolocation.getCurrentPosition(
      () => setState("granted"),
      (err) => {
        // PERMISSION_DENIED (1) → blocked; other errors (timeout/unavailable)
        // still mean we don't have a fix, so keep gating with a retry.
        setState("denied");
        void err;
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    // If the Permissions API already reports "granted", skip straight through;
    // otherwise trigger the prompt. Re-check on focus so flipping the OS/browser
    // setting and returning recovers without a manual reload.
    let cancelled = false;
    const start = async () => {
      try {
        const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
        if (cancelled) return;
        if (status?.state === "granted") {
          setState("granted");
          return;
        }
      } catch {
        /* Permissions API unavailable — fall through to a direct request. */
      }
      request();
    };
    void start();
    const onFocus = () => {
      if (!cancelled && state !== "granted") request();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (state === "granted") return <>{children}</>;

  const blocked = state === "denied" || state === "unsupported";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        textAlign: "center",
        gap: 6,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 22,
          background: blocked ? "var(--critical-bg)" : "var(--primary-bg)",
          border: `1px solid ${blocked ? "var(--critical)" : "var(--primary)"}`,
          display: "grid",
          placeItems: "center",
          fontSize: 34,
          marginBottom: 14,
        }}
      >
        📍
      </div>

      <h1 className="archivo" style={{ fontWeight: 800, fontSize: 22, margin: 0 }}>
        {blocked ? "Location is required" : "Allow location access"}
      </h1>
      <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6, maxWidth: 340, margin: "8px 0 0" }}>
        {state === "unsupported"
          ? "This device or browser can't share location, which this safety app needs to route help to you. Try a different browser."
          : blocked
            ? "Location is blocked. The medical team can't find you without it. Enable location for this site in your browser settings, then tap Try again."
            : "We need your location so Race Command and medics can reach you fast. Please accept the permission prompt."}
      </p>

      {state !== "unsupported" && (
        <button
          className="btn-primary"
          style={{ marginTop: 22, maxWidth: 320 }}
          onClick={request}
          disabled={state === "prompting"}
        >
          {state === "prompting" ? "Waiting for permission…" : "Try again"}
        </button>
      )}

      {blocked && (
        <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 16, maxWidth: 320, lineHeight: 1.5 }}>
          In a life-threatening emergency, call <strong style={{ color: "var(--critical)" }}>112</strong> directly.
        </p>
      )}
    </div>
  );
}
