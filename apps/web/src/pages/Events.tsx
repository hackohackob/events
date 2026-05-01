import React from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import Layout from "../components/Layout";
import { useEvents } from "../hooks/useEvents";

export default function EventsPage() {
  const { data = [], isLoading } = useEvents();

  return (
    <Layout>
      <div className="hero-band">
        <div className="breadcrumb"><strong>Events</strong></div>
        <div className="hero-actions">
          <Link className="primary-action" to="/events/new"><Plus size={18} /> Create Event</Link>
        </div>
      </div>

      <section className="page-panel">
        <div className="panel-heading">
          <h2>All Events</h2>
          <span>{isLoading ? "Loading..." : `${data.length} events`}</span>
        </div>
        <div className="event-table">
          {data.map((event) => (
            <article className="event-row" key={event.id}>
              <div>
                <strong>{event.name}</strong>
                <span>{new Date(event.startTime).toLocaleString()} - {new Date(event.endTime).toLocaleString()}</span>
              </div>
              <span className={`status-pill ${event.status}`}>{event.status}</span>
            </article>
          ))}
        </div>
      </section>
    </Layout>
  );
}
