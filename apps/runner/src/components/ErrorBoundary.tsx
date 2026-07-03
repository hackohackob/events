import { Component, type ReactNode } from "react";

/** Last automatic recovery reload — persisted across the reload itself so a
 *  crash-on-boot can't spin into an infinite reload loop. */
const RELOAD_STAMP_KEY = "rs_recovery_reload_at";
const RELOAD_LOOP_WINDOW_MS = 30_000;

interface Props {
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

/**
 * Root crash net. Without it, any uncaught error in a render or effect makes
 * React unmount the whole tree, leaving a dead black page (the classic
 * "resume PWA from a long background freeze → black screen"). Instead:
 * reload once automatically (fresh boots always recover), and if that reload
 * itself crashes within 30 s, stop and show a manual reload screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("App crashed:", error);
    const last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0);
    if (Date.now() - last > RELOAD_LOOP_WINDOW_MS) {
      sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--bg-base, #0a1118)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: 24,
          textAlign: "center",
          color: "#e8eef5",
          fontFamily: "Manrope, system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Нещо се обърка</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "12px 28px",
            borderRadius: 12,
            border: "none",
            background: "#2E9BFF",
            color: "#fff",
            fontSize: 15,
            fontWeight: 800,
            fontFamily: "inherit",
          }}
        >
          Презареди
        </button>
      </div>
    );
  }
}
