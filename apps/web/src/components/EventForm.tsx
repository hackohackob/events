import React, { FormEvent, useMemo, useState } from "react";
import { CalendarDays, CloudUpload, Plus, X } from "lucide-react";
import DisciplineItem from "./DisciplineItem";
import type { EventTrack } from "../api/events";

interface CreateEventPayload {
  title: string;
  dates: string[];
  disciplines: Array<{ date: string; title: string; distanceKm: number; ascentMeters: number; color: string; gpxFile: string; trackId?: string }>;
}

const colors = ["#8A2BE2", "#1E90FF", "#28A745", "#FF8C00"];

interface DisciplineDraft {
  date: string;
  title: string;
  distanceKm: number;
  ascentMeters: number;
  color: string;
  gpxFile: string;
  trackId?: string;
}

const initialDates = ["2025-06-14", "2025-06-15"];

function prettyDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export default function EventForm({
  tracks,
  isSaving,
  onSubmit,
}: {
  tracks: EventTrack[];
  isSaving?: boolean;
  onSubmit: (payload: CreateEventPayload) => void;
}) {
  const [title, setTitle] = useState("Iron Peak Marathon 2025");
  const [dates, setDates] = useState(initialDates);
  const [disciplines, setDisciplines] = useState<DisciplineDraft[]>([
    { date: initialDates[0], title: "Trail Run 21 km", distanceKm: 21.2, ascentMeters: 1230, color: colors[0], gpxFile: "track_21k.gpx", trackId: tracks[1]?.id },
    { date: initialDates[0], title: "Trail Run 10 km", distanceKm: 10.5, ascentMeters: 620, color: colors[1], gpxFile: "track_10k.gpx", trackId: tracks[0]?.id },
    { date: initialDates[0], title: "MTB 45 km", distanceKm: 45.3, ascentMeters: 1650, color: colors[2], gpxFile: "track_mtb45.gpx", trackId: tracks[2]?.id },
    { date: initialDates[1], title: "Marathon 42 km", distanceKm: 42.2, ascentMeters: 2400, color: colors[3], gpxFile: "track_42k.gpx", trackId: tracks[2]?.id },
  ]);

  const selectedTrackIds = useMemo(() => new Set(disciplines.map((discipline) => discipline.trackId).filter(Boolean)), [disciplines]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      title,
      dates,
      disciplines: disciplines.map((discipline) => ({ ...discipline })),
    });
  }

  function updateDiscipline(index: number, patch: Partial<DisciplineDraft>) {
    setDisciplines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return (
    <form className="builder-main" id="create-event-form" onSubmit={submit}>
      <section className="event-form-section">
        <h2>Event Information</h2>

        <label>
          <span>Event Title <b>*</b></span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>

        <div className="event-image-label">Event Image</div>
        <div className="image-upload-grid">
          <div className="event-image-preview">
            <button className="remove-image" type="button" aria-label="Remove image"><X size={18} /></button>
          </div>
          <div className="upload-zone">
            <CloudUpload size={34} />
            <strong>Upload image</strong>
            <span>JPG, PNG or WebP</span>
          </div>
        </div>

        <label>
          <span>Event Date(s) <b>*</b></span>
          <div className="day-tabs">
            {dates.map((date) => (
              <button key={date} type="button" className="day-tab">
                {prettyDate(date)}
                <X size={15} />
              </button>
            ))}
            <button type="button" className="day-tab add" onClick={() => setDates((current) => [...current, "2025-06-16"])}><Plus size={16} /> Add day</button>
          </div>
        </label>
      </section>

      <section className="event-form-section disciplines-section">
        <div className="section-title-block">
          <h2>Days & Disciplines</h2>
          <p>Each day can have multiple disciplines with their own track and color.</p>
        </div>

        {dates.map((date) => (
          <div className="day-card" key={date}>
            <div className="day-card-header">
              <div><CalendarDays size={20} /> {prettyDate(date)}</div>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setDisciplines((current) => [
                  ...current,
                  {
                    date,
                    title: "New Discipline",
                    distanceKm: 0,
                    ascentMeters: 0,
                    color: colors[current.length % colors.length],
                    gpxFile: "track.gpx",
                    trackId: tracks.find((track) => !selectedTrackIds.has(track.id))?.id,
                  },
                ])}
              >
                <Plus size={18} /> Add Discipline
              </button>
            </div>
            <div className="discipline-list">
              {disciplines.map((discipline, index) => discipline.date === date && (
                <DisciplineItem
                  key={`${discipline.date}-${discipline.title}-${index}`}
                  title={discipline.title}
                  distance={`${discipline.distanceKm || 0} km • ${discipline.ascentMeters || 0} m+`}
                  file={discipline.gpxFile}
                  color={discipline.color}
                  tracks={tracks}
                  trackId={discipline.trackId}
                  onTrackChange={(trackId) => updateDiscipline(index, { trackId, gpxFile: tracks.find((track) => track.id === trackId)?.label || discipline.gpxFile })}
                />
              ))}
            </div>
          </div>
        ))}

        <button className="primary-action form-save-action" type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Event"}
        </button>
      </section>
    </form>
  );
}
