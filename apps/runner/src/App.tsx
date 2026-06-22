import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./state/AppContext";
import { Onboarding } from "./screens/Onboarding";
import { ReportSheet } from "./screens/ReportSheet";
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
  const { profile } = useApp();
  const onboarded = Boolean(profile?.selectedTrackId);

  return (
    <LocationGate>
      <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "var(--bg-base)" }} />}>
        <OfflineBanner />
        <Routes>
        <Route path="/" element={onboarded ? <Navigate to="/map" replace /> : <Navigate to="/onboarding" replace />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/map" element={<MapScreen />} />
        <Route path="/tracks" element={<TracksScreen />} />
        <Route path="/report" element={<ReportSheet />} />
        <Route path="/report/full" element={<ReportFullScreen />} />
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
