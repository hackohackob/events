import React from "react";
import { Link, NavLink } from "react-router-dom";
import {
  CalendarDays,
  ChevronDown,
  FileText,
  Home,
  LogOut,
  MessageSquare,
  Settings,
  Siren,
  Truck,
  UsersRound,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function Layout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand">
          <svg className="brand-emblem" viewBox="0 0 72 72" aria-hidden="true">
            <path d="M36 3 63 18v36L36 69 9 54V18L36 3Z" fill="#0b151c" stroke="#f4f8fb" strokeWidth="2" />
            <path d="m36 58 13-13 4 7-17 9-17-9 4-7 13 13Z" fill="#57bf5b" />
            <path d="M29 15h14v13l11-7 7 12-11 7 11 7-7 12-11-7v13H29V52l-11 7-7-12 11-7-11-7 7-12 11 7V15Z" fill="#f7fbff" />
            <path d="M36 18v37m-5-30c8 1 9 8 0 11 10 3 10 9 0 12m10-23c-8 1-9 8 0 11-10 3-10 9 0 12" fill="none" stroke="#071019" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <div>
            <div className="brand-title">PARAMEDIC</div>
            <div className="brand-subtitle">EVENT APP</div>
          </div>
        </Link>

        <nav>
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><Home size={20} /> Dashboard</NavLink>
          <NavLink to="/events" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><CalendarDays size={20} /> Events</NavLink>
          <NavLink to="/incidents" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><Siren size={20} /> Incidents</NavLink>
          <NavLink to="/units" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><Truck size={20} /> Units</NavLink>
          <NavLink to="/users" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><UsersRound size={20} /> Users</NavLink>
          <NavLink to="/reports" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><FileText size={20} /> Reports</NavLink>
          <NavLink to="/messages" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><MessageSquare size={20} /> Messages</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}><Settings size={20} /> Settings</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="operator">
            <div className="avatar"><UsersRound size={20} /></div>
            <div>
              <strong>John Staff</strong>
              <span>Administrator</span>
            </div>
            <ChevronDown size={16} />
          </div>
          <Link to="/login" className="nav-item logout-link" onClick={logout}><LogOut size={18} /> Log out</Link>
        </div>
      </aside>

      <main className="content-shell">
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
