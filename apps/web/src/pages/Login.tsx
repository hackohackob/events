import React, { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Eye, EyeOff, LockKeyhole, Mail, MapPin, UsersRound } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await login({ name: email || "Staff", joinCode: "pancharevo" });
    navigate("/");
  }

  return (
    <div className="login-shell">
      <div className="login-visual">
        <div className="mountain-scene" aria-hidden="true">
          <div className="sunset-glow" />
          <div className="ridge ridge-back" />
          <div className="ridge ridge-mid" />
          <div className="ridge ridge-front" />
          <div className="valley-river" />
          <div className="topo-lines" />
        </div>

        <div className="visual-inner">
          <div className="login-brand-lockup">
            <svg className="brand-emblem large" viewBox="0 0 72 72" aria-hidden="true">
              <path d="M36 3 63 18v36L36 69 9 54V18L36 3Z" fill="#0b151c" stroke="#f4f8fb" strokeWidth="2" />
              <path d="m36 58 13-13 4 7-17 9-17-9 4-7 13 13Z" fill="#57bf5b" />
              <path d="M29 15h14v13l11-7 7 12-11 7 11 7-7 12-11-7v13H29V52l-11 7-7-12 11-7-11-7 7-12 11 7V15Z" fill="#f7fbff" />
              <path d="M36 18v37m-5-30c8 1 9 8 0 11 10 3 10 9 0 12m10-23c-8 1-9 8 0 11-10 3-10 9 0 12" fill="none" stroke="#071019" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <div>
              <div className="brand-title xl">PARAMEDIC</div>
              <div className="brand-subtitle xl">EVENT APP</div>
              <div className="brand-portal">STAFF PORTAL</div>
            </div>
          </div>

          <p className="login-tagline">Manage events, tracks, units and incidents.<br />Everything in one place.</p>

          <div className="hero-benefits">
            <div>
              <CalendarDays size={34} />
              <div className="hero-benefit-title">Event Management</div>
              <div className="hero-benefit-copy">Create and manage multi-day events</div>
            </div>
            <div>
              <MapPin size={38} />
              <div className="hero-benefit-title">Live Tracks</div>
              <div className="hero-benefit-copy">Upload GPX tracks and manage disciplines</div>
            </div>
            <div>
              <UsersRound size={38} />
              <div className="hero-benefit-title">Team Coordination</div>
              <div className="hero-benefit-copy">Manage units, users and responders</div>
            </div>
          </div>

          <div className="login-copyright">© 2025 Paramedic Event App. All rights reserved.</div>
        </div>
      </div>

      <div className="login-panel">
        <form className="login-form panel fade-in" onSubmit={submit}>
          <div>
            <h3>Welcome back</h3>
            <p className="eyebrow">Sign in to your staff account</p>
          </div>

          <label>
            <span>Email address</span>
            <div className="input-with-icon">
              <Mail className="input-icon" size={23} />
              <input placeholder="Enter your email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </label>

          <label>
            <span>Password</span>
            <div className="input-with-icon">
              <LockKeyhole className="input-icon" size={23} />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="icon-button password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <div className="login-controls">
            <label className="remember-row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Remember me</span>
            </label>
            <a className="ghost-action" href="#">Forgot password?</a>
          </div>

          <button className="primary-action" type="submit"><LockKeyhole size={22} /> Sign In</button>

          <div className="login-divider">OR</div>

          <button type="button" className="secondary-action google-signin" onClick={() => alert("Google sign-in placeholder")}>
            <span className="google-g">G</span>
            Sign in with Google
          </button>

          <div className="login-footer-copy">
            Need access? <a href="#">Contact your administrator.</a>
          </div>
        </form>
      </div>
    </div>
  );
}
