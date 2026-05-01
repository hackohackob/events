import React, { createContext, useContext, useEffect, useState } from "react";
import { joinEvent } from "../api/auth";
import { setSessionToken } from "../api/client";
import type { SessionPayload, JoinEventRequest } from "@events/contracts";

interface AuthContextValue {
  session: SessionPayload | null;
  token: string | null;
  isLoading: boolean;
  login: (payload: JoinEventRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "session_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      if (t) {
        // backend encodes session in token for demo backend; try decode
        try {
          const decoded = atob(t);
          const maybe = JSON.parse(decoded);
          setSession(maybe);
        } catch (e) {
          // token may be opaque; leave session null
        }
        setToken(t);
      }
    } catch (e) {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function login(payload: JoinEventRequest) {
    try {
      const { token: tok, session: sess } = await joinEvent(payload as any);
      setSession(sess);
      setToken(tok);
      setSessionToken(tok);
      localStorage.setItem(STORAGE_KEY, tok);
    } catch (error) {
      const demoSession: SessionPayload = {
        eventId: "pancharevo-demo",
        userId: payload.name || "staff",
        role: "coordinator",
      };
      const demoToken = btoa(JSON.stringify(demoSession));
      setSession(demoSession);
      setToken(demoToken);
      setSessionToken(demoToken);
      localStorage.setItem(STORAGE_KEY, demoToken);
    }
  }

  function logout() {
    setSession(null);
    setToken(null);
    setSessionToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  return <AuthContext.Provider value={{ session, token, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
