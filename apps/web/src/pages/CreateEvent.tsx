import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import EventForm from "../components/EventForm";
import MapPlaceholder from "../components/MapPlaceholder";
import { useCreateEvent, useTracks } from "../hooks/useEvents";
import type { CreateEventPayload, EventTrack } from "../api/events";

const fallbackTracks: EventTrack[] = [
  { id: "fallback-21k", label: "Trail Run 21 km", color: "#8A2BE2", points: [] },
  { id: "fallback-10k", label: "Trail Run 10 km", color: "#1E90FF", points: [] },
  { id: "fallback-mtb", label: "MTB 45 km", color: "#28A745", points: [] },
  { id: "fallback-42k", label: "Marathon 42 km", color: "#FF8C00", points: [] },
];

export default function CreateEventPage() {
  const navigate = useNavigate();
  const tracksQuery = useTracks();
  const createEvent = useCreateEvent();
  const tracks = tracksQuery.data?.length ? tracksQuery.data : fallbackTracks;

  const previewTracks = useMemo(() => tracks.map((track, index) => ({
    ...track,
    color: track.color || ["#8A2BE2", "#1E90FF", "#28A745", "#FF8C00"][index % 4],
  })), [tracks]);

  function submit(payload: CreateEventPayload) {
    createEvent.mutate(payload, {
      onSuccess: () => navigate("/events"),
    });
  }

  return (
    <Layout>
      <div className="hero-band">
        <div className="breadcrumb">
          <span>Events</span>
          <span>›</span>
          <strong>Create New Event</strong>
        </div>

        <div className="hero-actions">
          <button className="ghost-action" type="button" onClick={() => navigate("/events")}>Cancel</button>
          <button className="primary-action" type="submit" form="create-event-form" disabled={createEvent.isLoading}>
            {createEvent.isLoading ? "Saving..." : "Save Event"}
          </button>
        </div>
      </div>

      <div className="builder-layout">
        <EventForm tracks={previewTracks} isSaving={createEvent.isLoading} onSubmit={submit} />
        <MapPlaceholder tracks={previewTracks} />
      </div>
    </Layout>
  );
}
