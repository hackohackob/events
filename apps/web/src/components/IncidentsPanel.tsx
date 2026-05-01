import React, { useState } from "react";
import { useIncidents, useCreateIncident, useIncidentAction } from "../hooks/useIncidents";

export default function IncidentsPanel() {
  const { data: incidents, isLoading } = useIncidents();
  const create = useCreateIncident();
  const action = useIncidentAction();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({ eventId: "", lat: 0, lng: 0, type: "other", description: title });
      setTitle("");
      setCreating(false);
    } catch (err) {
      // ignore
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">Incidents</h2>
        <button className="px-2 py-1 border rounded text-sm" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "+ New"}
        </button>
      </div>

      {creating && (
        <form onSubmit={submitNew} className="mb-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short description" className="w-full border rounded px-2 py-1 mb-2" />
          <div className="flex justify-end">
            <button className="bg-green-600 text-white px-3 py-1 rounded" type="submit">Create</button>
          </div>
        </form>
      )}

      <div className="space-y-2 max-h-64 overflow-auto">
        {isLoading && <div>Loading incidents...</div>}
        {!(incidents || []).length && <div className="text-sm text-gray-500">No incidents</div>}
        {(incidents || []).map((inc: any) => (
          <article key={inc.id || inc._id || Math.random()} className="p-2 border rounded">
            <div className="flex justify-between items-start gap-2">
              <div>
                <strong className="block">{inc.title || inc.type || "Incident"}</strong>
                <div className="text-sm text-gray-600">{inc.status || inc.severity || ""}</div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => action.mutate({ id: inc.id, action: { incidentId: inc.id, action: "going" } })}
                  className="text-sm px-2 py-1 border rounded"
                >
                  Going
                </button>
                <button
                  onClick={() => action.mutate({ id: inc.id, action: { incidentId: inc.id, action: "arrived" } })}
                  className="text-sm px-2 py-1 border rounded"
                >
                  Arrived
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
