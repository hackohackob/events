import React from "react";
import { Activity, Bike, File, Pencil, Trash2 } from "lucide-react";
import type { EventTrack } from "../api/events";

export default function DisciplineItem({
  title,
  distance,
  file,
  color,
  tracks = [],
  trackId,
  onTrackChange,
}: {
  title: string;
  distance: string;
  file: string;
  color: string;
  tracks?: EventTrack[];
  trackId?: string;
  onTrackChange?: (trackId: string) => void;
}) {
  const isBike = title.toLowerCase().includes("mtb");

  return (
    <div className="discipline-item">
      <span className="color-dot" style={{ background: color }} />
      <div className="discipline-icon">{isBike ? <Bike size={27} /> : <Activity size={28} />}</div>
      <div className="discipline-copy">
        <strong>{title}</strong>
        <span>{distance}</span>
      </div>
      <div className="hex-pill" style={{ color, borderColor: color }}>{color.toUpperCase()}</div>
      {tracks.length ? (
        <select className="file-select" value={trackId || ""} onChange={(event) => onTrackChange?.(event.target.value)}>
          <option value="">No track</option>
          {tracks.map((track) => <option key={track.id} value={track.id}>{track.label}</option>)}
        </select>
      ) : (
        <div className="file-pill"><File size={16} /> {file}</div>
      )}
      <div className="discipline-actions">
        <button className="icon-button" type="button" aria-label={`Edit ${title}`}>
          <Pencil size={18} />
        </button>
        <button className="icon-button" type="button" aria-label={`Delete ${title}`}>
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}
