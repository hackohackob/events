import React, { useState } from "react";
import { useRunnerSearch } from "../hooks/useSearch";
import { useAuth } from "../contexts/AuthContext";

export default function RunnerSearch() {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const { data, isLoading } = useRunnerSearch(
    query ? { eventId: session?.eventId || "", name: query } : null,
  );

  return (
    <div>
      <h2 className="text-lg font-bold mb-2">Runner search</h2>
      <label className="block mb-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or bib" className="w-full border rounded px-2 py-1" />
      </label>

      <div className="max-h-40 overflow-auto space-y-2">
        {isLoading && <div>Searching…</div>}
        {!(data || []).length && !isLoading && <div className="text-sm text-gray-500">No results</div>}
        {(data || []).map((r: any) => (
          <div key={r.userId || r.id} className={`p-2 border rounded ${active === r.userId ? "bg-gray-100" : ""}`} onClick={() => setActive(r.userId)}>
            <div className="font-semibold">{r.name || r.userId}</div>
            <div className="text-sm text-gray-600">{r.bibNumber ? `#${r.bibNumber}` : r.note || ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
