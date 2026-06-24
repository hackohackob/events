import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./state/AppContext";
import { Onboarding } from "./screens/Onboarding";
import { WhoFor } from "./screens/WhoFor";
import { ReportFullScreen } from "./screens/ReportFullScreen";
import { Sending } from "./screens/Sending";
import { SosSent } from "./screens/SosSent";
import { GuidedCare } from "./screens/GuidedCare";
import { Terms } from "./screens/Terms";
import { Medical } from "./screens/Medical";
import { OfflineBanner } from "./components/OfflineBanner";
import { LocationGate } from "./components/LocationGate";

// Map-heavy screens pull in maplibre-gl — lazy-load them so the onboarding and
// emergency-report path stay tiny and load instantly on weak signal.
const MapScreen = lazy(() => import("./screens/MapScreen").then((m) => ({ default: m.MapScreen })));
const TracksScreen = lazy(() => import("./screens/TracksScreen").then((m) => ({ default: m.TracksScreen })));
const Confirm = lazy(() => import("./screens/Confirm").then((m) => ({ default: m.Confirm })));

export function App() {
  const { profile, eventId } = useApp();
  // Onboarded only when the runner has a track selected FOR THE CURRENT EVENT.
  // A selection made for a different event doesn't count (BIB/track aren't
  // carried across events), so they're sent back to onboarding to choose again.
  const onboarded = Boolean(profile?.selectedTrackId && profile.eventId === eventId);

  return (
    <LocationGate>
      <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "var(--bg-base)" }} />}>
        <OfflineBanner />
        <Routes>
        <Route path="/" element={onboarded ? <Navigate to="/map" replace /> : <Navigate to="/onboarding" replace />} />
        <Route path="/onboarding" element={<Onboarding />} />
        {/* Map & tracks require an onboarded profile for this event — otherwise
            there's no runner identity/track to render, so bounce to onboarding. */}
        <Route path="/map" element={onboarded ? <MapScreen /> : <Navigate to="/onboarding" replace />} />
        <Route path="/tracks" element={onboarded ? <TracksScreen /> : <Navigate to="/onboarding" replace />} />
        {/* Report flow: step 1 = who is it for, step 2 = what's happening. */}
        <Route path="/report" element={<WhoFor />} />
        <Route path="/report/what" element={<ReportFullScreen />} />
        <Route path="/confirm" element={<Confirm />} />
        <Route path="/sending" element={<Sending />} />
        <Route path="/sent" element={<SosSent />} />
        <Route path="/guided" element={<GuidedCare />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/medical" element={<Medical />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </LocationGate>
  );
}
