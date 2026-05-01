import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import EventsPage from "./pages/Events";
import CreateEventPage from "./pages/CreateEvent";
import UnitsPage from "./pages/Units";
import PlaceholderPage from "./pages/Placeholder";
import { useAuth } from "./contexts/AuthContext";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, session } = useAuth();
  if (isLoading) return null;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route path="/events" element={<ProtectedRoute><EventsPage /></ProtectedRoute>} />
      <Route path="/events/new" element={<ProtectedRoute><CreateEventPage /></ProtectedRoute>} />
      <Route path="/units" element={<ProtectedRoute><UnitsPage /></ProtectedRoute>} />
      <Route path="/incidents" element={<ProtectedRoute><PlaceholderPage title="Incidents" /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute><PlaceholderPage title="Users" /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute><PlaceholderPage title="Reports" /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><PlaceholderPage title="Messages" /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><PlaceholderPage title="Settings" /></ProtectedRoute>} />
    </Routes>
  );
}
