import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { apiFetch } from "../ui/api-client";
import { isOnline } from "../offline/connectivity";
import { useLocationStatus } from "../debug/location-status";
import { useSessionStore } from "../security/session-store";
import { extractCoordinates, formatCoordinate, type ParsedCoordinate } from "./coordinate-parser";
import { usePlacesStore, type PlaceCategory, type PlaceMatch } from "./places-store";
import { VEHICLE_TYPE_META } from "@events/contracts";
import { useSearchRecents } from "./search-recents";
import { useMapStore } from "../map/map-store";
import { incidentTitle } from "../incidents/IncidentSheet";
import { POI_TYPES } from "../map/poi-types";
import { debugLog } from "../debug/debug-log";

/** A location the caller can view or navigate to. */
export interface SearchTarget {
  lat: number;
  lng: number;
  label: string;
  /** Emoji for the map preview pin (category-specific). */
  icon?: string;
}

interface OnlinePlace {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  region?: string;
  osmValue?: string;
}

interface RunnerResult {
  userId: string;
  name: string;
  bibNumber: string;
  lastLat: number;
  lastLng: number;
  lastUpdate: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fly the map to the target and drop a preview pin. */
  onView: (target: SearchTarget) => void;
  /** Start the navigation flow to the target. */
  onNavigate: (target: SearchTarget) => void;
}

const CATEGORY_META: Record<PlaceCategory, { icon: string; label: string }> = {
  settlement: { icon: "🏘️", label: "Settlement" },
  locality:   { icon: "🌿", label: "Locality" },
  area:       { icon: "🗺️", label: "Area" },
  street:     { icon: "🛣️", label: "Street" },
  peak:       { icon: "⛰️", label: "Peak" },
  pass:       { icon: "🚵", label: "Pass" },
  river:      { icon: "🌊", label: "River" },
  lake:       { icon: "💧", label: "Lake" },
  spring:     { icon: "⛲", label: "Spring" },
  waterfall:  { icon: "💦", label: "Waterfall" },
  cave:       { icon: "🕳️", label: "Cave" },
  hut:        { icon: "🛖", label: "Hut" },
  viewpoint:  { icon: "🔭", label: "Viewpoint" },
  other:      { icon: "📍", label: "Place" },
};

const FORMAT_LABEL: Record<ParsedCoordinate["format"], string> = {
  decimal: "DEC",
  dm: "DM",
  dms: "DMS",
  utm: "UTM",
  geo: "LINK",
};

/** Glyph + label for a POI type, falling back to the generic "Other" entry. */
function poiMeta(type?: string) {
  return POI_TYPES.find((t) => t.id === type) ?? POI_TYPES[POI_TYPES.length - 1];
}

function distanceKmBetween(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Full-screen universal search: towns / villages / peaks / rivers / localities
 * (места and местности), pasted coordinates in any format (including buried in
 * long text), participant bibs — with the event's offline place pack ranked
 * first and available without connectivity.
 */
export function SearchOverlay({ visible, onClose, onView, onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [onlineResults, setOnlineResults] = useState<OnlinePlace[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [runnerResults, setRunnerResults] = useState<RunnerResult[]>([]);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const role = useSessionStore((s) => s.role);
  const myId = useSessionStore((s) => s.userId);
  const canSearchRunners = role === "medic" || role === "paramedic" || role === "coordinator";
  const myFix = useLocationStatus((s) => s.lastFix);
  const placesSearch = usePlacesStore((s) => s.search);
  const packCount = usePlacesStore((s) => s.places.length);

  // Ensure the offline pack is loaded whenever search opens.
  useEffect(() => {
    if (visible) {
      void usePlacesStore.getState().ensureLoaded();
      void useSearchRecents.getState().hydrate();
    }
  }, [visible]);

  // ── What's already on the map ──
  // An empty search box used to be a paragraph of help text. Everything a medic
  // is most likely to be looking for is already in memory — the open incidents,
  // the team, the event's own points — so it becomes a jump list instead. All of
  // it works offline; none of it costs a request.
  const markers = useMapStore((s) => s.markers);
  const recents = useSearchRecents((s) => s.recents);
  const clearRecents = useSearchRecents((s) => s.clear);

  const nearestFirst = <T extends { lat: number; lng: number }>(list: T[]): T[] => {
    if (!myFix) return list;
    return [...list].sort(
      (a, b) =>
        distanceKmBetween(myFix.lat, myFix.lng, a.lat, a.lng) -
        distanceKmBetween(myFix.lat, myFix.lng, b.lat, b.lng),
    );
  };

  const openIncidents = useMemo(
    () =>
      nearestFirst(
        markers.filter(
          (m) =>
            m.type === "incident" &&
            m.status !== "resolved" &&
            m.status !== "closed" &&
            m.status !== "archived",
        ),
      ).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, myFix],
  );

  const teamMarkers = useMemo(
    () => nearestFirst(markers.filter((m) => m.type === "paramedic" && m.id !== myId)).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, myFix, myId],
  );

  const poiMarkers = useMemo(
    () => nearestFirst(markers.filter((m) => m.type === "infrastructure" && !m.poiArchived)).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markers, myFix],
  );

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
    setQuery("");
    setOnlineResults([]);
    setRunnerResults([]);
  }, [visible]);

  // Parsed coordinates — instant, works fully offline, scans long pasted text.
  const coordinates = useMemo(() => extractCoordinates(query), [query]);

  // Offline pack matches — instant.
  const packMatches: PlaceMatch[] = useMemo(
    () => (coordinates.length > 0 ? [] : placesSearch(query)),
    [query, placesSearch, coordinates.length],
  );

  // Online autocomplete + bib search — debounced.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2 || coordinates.length > 0) {
      setOnlineResults([]);
      setRunnerResults([]);
      setOnlineLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeq.current;

      if (isOnline()) {
        setOnlineLoading(true);
        const bias = myFix ? `&lat=${myFix.lat}&lng=${myFix.lng}` : "";
        apiFetch<OnlinePlace[]>(`/search/places?q=${encodeURIComponent(trimmed)}${bias}`)
          .then((results) => {
            if (requestSeq.current !== seq) return;
            setOnlineResults(results);
          })
          .catch((err) => {
            if (requestSeq.current !== seq) return;
            setOnlineResults([]);
            debugLog("api", "warn", "place search failed", String(err));
          })
          .finally(() => {
            if (requestSeq.current === seq) setOnlineLoading(false);
          });
      }

      if (canSearchRunners && /^\d{1,5}$/.test(trimmed) && isOnline()) {
        apiFetch<RunnerResult[]>(`/search/runners?bibNumber=${encodeURIComponent(trimmed)}`)
          .then((results) => {
            if (requestSeq.current === seq) setRunnerResults(results);
          })
          .catch(() => undefined);
      } else {
        setRunnerResults([]);
      }
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, coordinates.length, canSearchRunners, myFix]);

  const distanceLabel = (lat: number, lng: number): string | null => {
    if (!myFix) return null;
    const km = distanceKmBetween(myFix.lat, myFix.lng, lat, lng);
    return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
  };

  const view = (target: SearchTarget) => {
    Keyboard.dismiss();
    void Haptics.selectionAsync();
    useSearchRecents.getState().remember(target);
    onView(target);
  };
  const navigate = (target: SearchTarget) => {
    Keyboard.dismiss();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    useSearchRecents.getState().remember(target);
    onNavigate(target);
  };

  if (!visible) return null;

  const showEmptyState =
    query.trim().length < 2 && coordinates.length === 0;
  const nothingFound =
    query.trim().length >= 2 &&
    coordinates.length === 0 &&
    packMatches.length === 0 &&
    onlineResults.length === 0 &&
    runnerResults.length === 0 &&
    !onlineLoading;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        {/* ── Search bar ── */}
        <View style={styles.searchBarRow}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8}>
            <Feather name="arrow-left" size={21} color="#cbd5e1" />
          </Pressable>
          <View style={styles.inputWrap}>
            <Feather name="search" size={16} color="#5b6b80" />
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Place, peak, river… or paste coordinates"
              placeholderTextColor="#4A5F7A"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              multiline={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Feather name="x" size={16} color="#5b6b80" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Coordinates found in the text ── */}
          {coordinates.length > 0 ? (
            <>
              <Text style={styles.sectionKicker}>
                COORDINATES FOUND{coordinates.length > 1 ? ` (${coordinates.length})` : ""}
              </Text>
              {coordinates.map((coord, index) => {
                const label = formatCoordinate(coord.lat, coord.lng);
                const dist = distanceLabel(coord.lat, coord.lng);
                const target = { lat: coord.lat, lng: coord.lng, label, icon: "🎯" };
                return (
                  <Pressable
                    key={`${coord.lat}-${coord.lng}-${index}`}
                    style={styles.row}
                    onPress={() => view(target)}
                  >
                    <View style={[styles.rowIcon, styles.coordIcon]}>
                      <Feather name="crosshair" size={16} color="#7dd3fc" />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{label}</Text>
                      <View style={styles.rowMetaLine}>
                        <View style={styles.formatBadge}>
                          <Text style={styles.formatBadgeText}>{FORMAT_LABEL[coord.format]}</Text>
                        </View>
                        {dist ? <Text style={styles.rowMeta}>{dist} away</Text> : null}
                      </View>
                    </View>
                    <Pressable style={styles.navBtn} hitSlop={4} onPress={() => navigate(target)}>
                      <Feather name="navigation" size={15} color="#04121f" />
                    </Pressable>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* ── Offline event pack (prioritised) ── */}
          {packMatches.length > 0 ? (
            <>
              <Text style={styles.sectionKicker}>ON THE COURSE  ·  OFFLINE</Text>
              {packMatches.map((place) => {
                const meta = CATEGORY_META[place.category] ?? CATEGORY_META.other;
                const dist = distanceLabel(place.lat, place.lng);
                const target = { lat: place.lat, lng: place.lng, label: place.name, icon: meta.icon };
                return (
                  <Pressable key={place.id} style={[styles.row, styles.packRow]} onPress={() => view(target)}>
                    <View style={[styles.rowIcon, styles.packIcon]}>
                      <Text style={styles.rowIconEmoji} allowFontScaling={false}>{meta.icon}</Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{place.name}</Text>
                      <Text style={styles.rowMeta}>
                        {meta.label}
                        {dist ? `  ·  ${dist} away` : ""}
                      </Text>
                    </View>
                    <Pressable style={styles.navBtn} hitSlop={4} onPress={() => navigate(target)}>
                      <Feather name="navigation" size={15} color="#04121f" />
                    </Pressable>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* ── Participants (bib) ── */}
          {runnerResults.length > 0 ? (
            <>
              <Text style={styles.sectionKicker}>PARTICIPANTS</Text>
              {runnerResults.map((runner) => {
                const target = {
                  lat: runner.lastLat,
                  lng: runner.lastLng,
                  label: `${runner.name} · #${runner.bibNumber}`,
                  icon: "🏃",
                };
                return (
                  <Pressable key={runner.userId} style={styles.row} onPress={() => view(target)}>
                    <View style={[styles.rowIcon, styles.runnerIcon]}>
                      <Text style={styles.runnerBibText} allowFontScaling={false}>#{runner.bibNumber}</Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{runner.name}</Text>
                      <Text style={styles.rowMeta}>
                        Last seen {new Date(runner.lastUpdate).toLocaleTimeString()}
                      </Text>
                    </View>
                    <Feather name="map-pin" size={16} color="#64748b" />
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* ── Online places ── */}
          {onlineLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#34d399" />
              <Text style={styles.loadingText}>Searching places…</Text>
            </View>
          ) : null}
          {onlineResults.length > 0 ? (
            <>
              <Text style={styles.sectionKicker}>PLACES</Text>
              {onlineResults.map((place) => {
                const meta = CATEGORY_META[place.category] ?? CATEGORY_META.other;
                const dist = distanceLabel(place.lat, place.lng);
                const target = { lat: place.lat, lng: place.lng, label: place.name, icon: meta.icon };
                return (
                  <Pressable key={place.id} style={styles.row} onPress={() => view(target)}>
                    <View style={styles.rowIcon}>
                      <Text style={styles.rowIconEmoji} allowFontScaling={false}>{meta.icon}</Text>
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{place.name}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {meta.label}
                        {place.region ? `  ·  ${place.region}` : ""}
                        {dist ? `  ·  ${dist}` : ""}
                      </Text>
                    </View>
                    <Pressable style={styles.navBtn} hitSlop={4} onPress={() => navigate(target)}>
                      <Feather name="navigation" size={15} color="#04121f" />
                    </Pressable>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* ── Empty box: a jump list of what's already on the map ── */}
          {showEmptyState ? (
            <>
              {recents.length > 0 ? (
                <>
                  <View style={styles.kickerRow}>
                    <Text style={styles.sectionKicker}>RECENT</Text>
                    <Pressable onPress={clearRecents} hitSlop={8}>
                      <Text style={styles.clearLink}>Clear</Text>
                    </Pressable>
                  </View>
                  {recents.map((recent) => {
                    const dist = distanceLabel(recent.lat, recent.lng);
                    const target = {
                      lat: recent.lat,
                      lng: recent.lng,
                      label: recent.label,
                      icon: recent.icon,
                    };
                    return (
                      <Pressable
                        key={`${recent.label}-${recent.at}`}
                        style={styles.row}
                        onPress={() => view(target)}
                      >
                        <View style={styles.rowIcon}>
                          {recent.icon ? (
                            <Text style={styles.rowIconEmoji} allowFontScaling={false}>{recent.icon}</Text>
                          ) : (
                            <Feather name="clock" size={15} color="#7e93ac" />
                          )}
                        </View>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{recent.label}</Text>
                          <Text style={styles.rowMeta}>{dist ? `${dist} away` : "Recently viewed"}</Text>
                        </View>
                        <Pressable style={styles.navBtn} hitSlop={4} onPress={() => navigate(target)}>
                          <Feather name="navigation" size={15} color="#04121f" />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}

              {openIncidents.length > 0 ? (
                <>
                  <Text style={styles.sectionKicker}>OPEN INCIDENTS  ·  {openIncidents.length}</Text>
                  {openIncidents.map((incident) => {
                    const dist = distanceLabel(incident.lat, incident.lng);
                    const target = {
                      lat: incident.lat,
                      lng: incident.lng,
                      label: incidentTitle(incident),
                      icon: "🚨",
                    };
                    return (
                      <Pressable key={incident.id} style={[styles.row, styles.incidentRow]} onPress={() => view(target)}>
                        <View style={[styles.rowIcon, styles.incidentIcon]}>
                          <Text style={styles.rowIconEmoji} allowFontScaling={false}>🚨</Text>
                        </View>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{incidentTitle(incident)}</Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {(incident.status ?? "open").replace(/_/g, " ")}
                            {dist ? `  ·  ${dist} away` : ""}
                          </Text>
                        </View>
                        <Pressable style={styles.navBtn} hitSlop={4} onPress={() => navigate(target)}>
                          <Feather name="navigation" size={15} color="#04121f" />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}

              {teamMarkers.length > 0 ? (
                <>
                  <Text style={styles.sectionKicker}>TEAM</Text>
                  {teamMarkers.map((medic) => {
                    const dist = distanceLabel(medic.lat, medic.lng);
                    const vehicle = medic.vehicleType ? VEHICLE_TYPE_META[medic.vehicleType] : null;
                    const label = medic.name ?? medic.label;
                    const target = { lat: medic.lat, lng: medic.lng, label, icon: vehicle?.icon ?? "🚑" };
                    return (
                      <Pressable key={medic.id} style={styles.row} onPress={() => view(target)}>
                        <View style={[styles.rowIcon, styles.medicIcon]}>
                          <Text style={styles.rowIconEmoji} allowFontScaling={false}>
                            {vehicle?.icon ?? "🚑"}
                          </Text>
                        </View>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{label}</Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {[vehicle?.label, (medic.status ?? "available").replace(/_/g, " "), dist ? `${dist} away` : null]
                              .filter(Boolean)
                              .join("  ·  ")}
                          </Text>
                        </View>
                        <Feather name="map-pin" size={16} color="#64748b" />
                      </Pressable>
                    );
                  })}
                </>
              ) : null}

              {poiMarkers.length > 0 ? (
                <>
                  <Text style={styles.sectionKicker}>EVENT POINTS</Text>
                  {poiMarkers.map((poi) => {
                    const meta = poiMeta(poi.poiType);
                    const dist = distanceLabel(poi.lat, poi.lng);
                    const label = poi.name ?? poi.label;
                    const target = { lat: poi.lat, lng: poi.lng, label, icon: meta.icon };
                    return (
                      <Pressable key={poi.id} style={styles.row} onPress={() => view(target)}>
                        <View style={styles.rowIcon}>
                          <Text style={styles.rowIconEmoji} allowFontScaling={false}>{meta.icon}</Text>
                        </View>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{label}</Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {meta.label}
                            {dist ? `  ·  ${dist} away` : ""}
                          </Text>
                        </View>
                        <Pressable style={styles.navBtn} hitSlop={4} onPress={() => navigate(target)}>
                          <Feather name="navigation" size={15} color="#04121f" />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </>
              ) : null}

              {/* The old help card, kept but demoted to a footer — it matters
                  once, when you don't know coordinates can be pasted. */}
              <View style={styles.hintCard}>
                <Text style={styles.hintTitle}>Search anything</Text>
                <Text style={styles.hintBody}>
                  Towns, peaks, rivers and localities — or paste coordinates in any format
                  (42.6977, 23.3219 · 42°41'52"N · UTM), even buried in a longer message.
                  {canSearchRunners ? " A bare number finds a participant by bib." : ""}
                </Text>
                {packCount > 0 ? (
                  <View style={styles.packBadge}>
                    <Feather name="download-cloud" size={12} color="#34d399" />
                    <Text style={styles.packBadgeText}>
                      {packCount} course places available offline
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}
          {nothingFound ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🤷</Text>
              <Text style={styles.emptyTitle}>Nothing found</Text>
              <Text style={styles.emptyBody}>
                {isOnline()
                  ? "Try a different spelling — both Cyrillic and Latin work."
                  : "You're offline — only course places and coordinates are searchable right now."}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#060c18",
    zIndex: 60,
  },
  flex: { flex: 1 },

  searchBarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: Platform.OS === "ios" ? 58 : 40,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(148,163,184,0.16)",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "#101d32",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(56,189,248,0.25)",
    paddingHorizontal: 13,
    height: 46,
  },
  input: { flex: 1, color: "#EFF6FF", fontSize: 15, fontWeight: "600", paddingVertical: 0 },
  listContent: { padding: 14, paddingBottom: 80 },
  sectionKicker: {
    color: "#4A5F7A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginTop: 14,
    marginBottom: 8,
    marginLeft: 4,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#0c1626",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 7,
  },
  packRow: { borderColor: "rgba(52,211,153,0.22)", backgroundColor: "rgba(16,185,129,0.05)" },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(148,163,184,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  coordIcon: { backgroundColor: "rgba(56,189,248,0.12)" },
  packIcon: { backgroundColor: "rgba(52,211,153,0.12)" },
  runnerIcon: { backgroundColor: "rgba(59,130,246,0.14)" },
  runnerBibText: { color: "#93c5fd", fontSize: 11, fontWeight: "900" },
  rowIconEmoji: { fontSize: 17, lineHeight: 21, includeFontPadding: false },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: "#E9F1FA", fontSize: 14.5, fontWeight: "800" },
  rowMetaLine: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  rowMeta: { color: "#5b6b80", fontSize: 11.5, fontWeight: "600", marginTop: 2 },
  formatBadge: {
    backgroundColor: "rgba(56,189,248,0.14)",
    borderRadius: 5,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  formatBadgeText: { color: "#7dd3fc", fontSize: 8.5, fontWeight: "900", letterSpacing: 0.6 },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#34d399",
    alignItems: "center",
    justifyContent: "center",
  },

  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  loadingText: { color: "#64748b", fontSize: 12.5, fontWeight: "600" },

  kickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clearLink: { color: "#5b6b80", fontSize: 11.5, fontWeight: "800" },
  incidentRow: { borderColor: "rgba(248,113,113,0.22)", borderWidth: 1 },
  incidentIcon: { backgroundColor: "rgba(248,113,113,0.14)" },
  medicIcon: { backgroundColor: "rgba(52,211,153,0.12)" },
  hintCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.1)",
    alignItems: "center",
  },
  hintTitle: { color: "#8da3bd", fontSize: 13, fontWeight: "900" },
  hintBody: {
    color: "#5b6b80",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 17,
  },
  emptyState: { alignItems: "center", paddingTop: 60, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: { color: "#cbd5e1", fontSize: 17, fontWeight: "900", marginTop: 14 },
  emptyBody: { color: "#5b6b80", fontSize: 13, fontWeight: "500", textAlign: "center", marginTop: 8, lineHeight: 19 },
  packBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 18,
    backgroundColor: "rgba(52,211,153,0.1)",
    borderColor: "rgba(52,211,153,0.3)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  packBadgeText: { color: "#34d399", fontSize: 11.5, fontWeight: "800" },
});
