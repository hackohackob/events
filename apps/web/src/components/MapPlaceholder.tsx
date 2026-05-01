import React from "react";
import { Check, ChevronRight, Layers, Mountain } from "lucide-react";
import { EventMap } from "../EventMap";
import type { EventTrack } from "../api/events";

export default function MapPlaceholder({ tracks = [] }: { tracks?: EventTrack[] }) {
  const visibleTracks = tracks.length ? tracks : [];
  const drawableTracks = visibleTracks.filter((track) => track.points.length > 1);

  return (
    <div className="builder-preview">
      <div className="map-shell maplibre-shell">
        <EventMap mode="preview" tracks={drawableTracks} />
      </div>

      <div className="layers-pill"><Layers size={22} /> Layers <ChevronRight size={20} /></div>

      <div className="map-card track-card">
        <h3>Tracks</h3>
        {(visibleTracks.length ? visibleTracks : [
          { id: "fallback-21k", label: "Trail Run 21 km", color: "#8A2BE2" },
          { id: "fallback-10k", label: "Trail Run 10 km", color: "#1E90FF" },
          { id: "fallback-mtb", label: "MTB 45 km", color: "#28A745" },
          { id: "fallback-42k", label: "Marathon 42 km", color: "#FF8C00" },
        ]).map((track, index) => (
          <div className="track-row" key={track.id}>
            <span className="checkbox"><Check size={13} /></span>
            <i style={{ background: track.color || ["#8A2BE2", "#1E90FF", "#28A745", "#FF8C00"][index % 4] }} />
            {track.label}
          </div>
        ))}

        <h3 className="map-layer-heading">Map Layers</h3>
        <div className="radio-row active">Mapy Outdoor</div>
        <div className="radio-row">Satellite</div>
        <div className="radio-row">Terrain</div>
      </div>

      <div className="terrain-badge"><Mountain size={18} /> Outdoor</div>
    </div>
  );
}
