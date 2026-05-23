import React from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Plus, Route, Truck } from "lucide-react";
import Layout from "../components/Layout";
import MapPlaceholder from "../components/MapPlaceholder";
import { useEvents, useTracks } from "../hooks/useEvents";

export default function DashboardPage() {
  const events = useEvents();
  const tracks = useTracks();
  const eventCount = events.data?.length ?? 0;

  return (
    <Layout>
      <div className="hero-band">
        <div className="breadcrumb">
          <strong>Dashboard</strong>
        </div>
        <div className="hero-actions">
          <Link className="primary-action" to="/events/new"><Plus size={18} /> Create Event</Link>
        </div>
      </div>

      <div className="overview-layout">
        <section className="overview-panel">
          <div className="metric-grid">
            <article className="metric-card"><CalendarDays size={22} /><span>Events</span><strong>{eventCount}</strong></article>
            <article className="metric-card"><Route size={22} /><span>Tracks</span><strong>{tracks.data?.length ?? 0}</strong></article>
            <article className="metric-card"><Truck size={22} /><span>Units endpoint</span><strong>Ready</strong></article>
          </div>

          <div className="list-panel">
            <div className="panel-heading">
              <h2>Recent Events</h2>
              <Link to="/events">View all</Link>
            </div>
            {(events.data ?? []).map((event) => (
              <div className="event-row" key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <span>{event.dates?.[0] ? new Date(event.dates[0]).toLocaleDateString() : '—'}</span>
                </div>
                <span className={`status-pill ${event.status}`}>{event.status}</span>
              </div>
            ))}
          </div>
        </section>

        <MapPlaceholder tracks={tracks.data} />
      </div>
    </Layout>
  );
}
