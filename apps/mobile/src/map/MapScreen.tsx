import React, { useEffect } from "react";
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ExpoLocation from "expo-location";
import MapView, { Marker, Polyline, UrlTile } from "react-native-maps";
import { getSocket } from "../realtime/socket-client";
import { apiFetch } from "../ui/api-client";
import { getMapyTilesTemplateUrl } from "./mapy-config";
import { useMapStore } from "./map-store";

const CURRENT_USER_ID = "mobile-user";
type AppViewMode = "runner" | "paramedic";

interface EventTrackResponse {
  id: string;
  label: string;
  points: Array<{ lat: number; lng: number }>;
}

interface EventLocationResponse {
  eventId: string;
  userId: string;
  lat: number;
  lng: number;
  timestamp: string;
  freshness: "fresh" | "warning" | "stale" | "offline";
  type?: "runner" | "paramedic" | "incident";
  label?: string;
  name?: string;
  bibNumber?: string;
  vehicle?: string;
  avatarUrl?: string;
  description?: string;
  respondingIncidentId?: string;
  respondingParamedicIds?: string[];
}

function markerInitials(label: string): string {
  const words = label
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return "PM";
}

function offsetTrackCoordinates(
  points: Array<{ lat: number; lng: number }>,
  offsetLat: number,
  offsetLng: number,
): Array<{ latitude: number; longitude: number }> {
  return points.map((point) => ({
    latitude: point.lat + offsetLat,
    longitude: point.lng + offsetLng,
  }));
}

export function MapScreen({ viewMode }: { viewMode: AppViewMode }) {
  const markers = useMapStore((state) => state.markers);
  const tracks = useMapStore((state) => state.tracks);
  const centerOnUserRequestId = useMapStore((state) => state.centerOnUserRequestId);
  const resetNorthRequestId = useMapStore((state) => state.resetNorthRequestId);
  const setMarkers = useMapStore((state) => state.setMarkers);
  const setTracks = useMapStore((state) => state.setTracks);
  const mapRef = React.useRef<MapView | null>(null);
  const incidentPulse = React.useRef(new Animated.Value(0)).current;
  const [selectedMarkerId, setSelectedMarkerId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<"map" | "reports" | "units" | "profile">("map");
  const [tick, setTick] = React.useState(0);
  const mapyTilesTemplateUrl = getMapyTilesTemplateUrl();

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 700);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(incidentPulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(incidentPulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [incidentPulse]);

  useEffect(() => {
    let mounted = true;

    const loadInitialData = async () => {
      try {
        const [initialLocations, eventTracks] = await Promise.all([
          apiFetch<EventLocationResponse[]>("/locations/event"),
          apiFetch<EventTrackResponse[]>("/events/tracks"),
        ]);

        if (!mounted) {
          return;
        }

        setMarkers(
          initialLocations.map((item) => ({
            id: item.userId,
            type: item.type ?? "runner",
            label: item.label ?? item.userId,
            lat: item.lat,
            lng: item.lng,
            staleState: item.freshness,
            name: item.name,
            bibNumber: item.bibNumber,
            vehicle: item.vehicle,
            avatarUrl: item.avatarUrl,
            description: item.description,
            respondingIncidentId: item.respondingIncidentId,
            respondingParamedicIds: item.respondingParamedicIds,
          })),
        );
        setTracks(eventTracks);
      } catch {
        if (mounted) {
          setTracks([]);
        }
      }
    };

    void loadInitialData();
    return () => {
      mounted = false;
    };
  }, [setMarkers, setTracks]);

  useEffect(() => {
    const socket = getSocket();
    socket.on("location.updated", (payload) => {
      const existing = useMapStore.getState().markers;
      setMarkers(
        [
          ...existing.filter((marker) => marker.id !== payload.userId),
          {
            id: payload.userId,
            type: "runner" as const,
            label: payload.userId,
            lat: payload.lat,
            lng: payload.lng,
            staleState: payload.freshness,
          },
        ].slice(-2000),
      );
    });
    socket.on("incident.created", (payload) => {
      const existing = useMapStore.getState().markers;
      setMarkers(
        [
          ...existing,
          {
            id: payload.id,
            type: "incident" as const,
            label: payload.type,
            lat: payload.lat,
            lng: payload.lng,
          },
        ].slice(-2000),
      );
    });
    return () => {
      socket.off("location.updated");
      socket.off("incident.created");
    };
  }, [setMarkers]);

  useEffect(() => {
    const centerOnUser = async () => {
      const permission = await ExpoLocation.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        return;
      }
      const location = await ExpoLocation.getCurrentPositionAsync({});
      mapRef.current?.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        450,
      );
    };

    if (centerOnUserRequestId > 0) {
      void centerOnUser();
    }
  }, [centerOnUserRequestId]);

  useEffect(() => {
    const resetNorth = async () => {
      const camera = await mapRef.current?.getCamera();
      if (!camera) {
        return;
      }
      mapRef.current?.animateCamera(
        {
          ...camera,
          heading: 0,
        },
        { duration: 350 },
      );
    };

    if (resetNorthRequestId > 0) {
      void resetNorth();
    }
  }, [resetNorthRequestId]);

  const visibleMarkers = markers.filter((marker) => {
    if (marker.id === CURRENT_USER_ID) {
      return false;
    }
    return true;
  });
  const markerById = new Map(visibleMarkers.map((marker) => [marker.id, marker]));
  const selectedMarker = selectedMarkerId ? markerById.get(selectedMarkerId) : undefined;
  const respondingParamedics = visibleMarkers.filter((marker) => marker.type === "paramedic" && marker.respondingIncidentId);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={mapyTilesTemplateUrl ? "none" : "standard"}
        showsUserLocation
        followsUserLocation
        initialRegion={{
          latitude: 42.6977,
          longitude: 23.3219,
          latitudeDelta: 0.07,
          longitudeDelta: 0.07,
        }}
      >
        {mapyTilesTemplateUrl ? (
          <UrlTile
            urlTemplate={mapyTilesTemplateUrl}
            maximumZ={19}
            flipY={false}
            zIndex={0}
          />
        ) : null}

        {tracks.map((track) => (
          <Polyline
            key={track.id}
            coordinates={offsetTrackCoordinates(
              track.points,
              track.id === "track-21k" ? 0.000035 : track.id === "track-42k" ? -0.000035 : 0,
              track.id === "track-21k" ? 0.000035 : track.id === "track-42k" ? -0.000035 : 0,
            )}
            strokeColor={track.id === "track-10k" ? "#16a34a" : track.id === "track-21k" ? "#f59e0b" : "#2563eb"}
            strokeWidth={7}
            zIndex={3}
            lineDashPattern={[3, 10]}
          />
        ))}

        {respondingParamedics.map((paramedic, index) => {
          const incident = paramedic.respondingIncidentId ? markerById.get(paramedic.respondingIncidentId) : undefined;
          if (!incident) {
            return null;
          }

          const progress = ((tick * 0.13 + index * 0.22) % 1 + 1) % 1;
          const arrowLat = paramedic.lat + (incident.lat - paramedic.lat) * progress;
          const arrowLng = paramedic.lng + (incident.lng - paramedic.lng) * progress;
          const angleDeg = (Math.atan2(incident.lng - paramedic.lng, incident.lat - paramedic.lat) * 180) / Math.PI;

          return (
            <React.Fragment key={`response-${paramedic.id}`}>
              <Polyline
                coordinates={[
                  { latitude: paramedic.lat, longitude: paramedic.lng },
                  { latitude: incident.lat, longitude: incident.lng },
                ]}
                strokeColor="#5ad06b"
                strokeWidth={4}
                zIndex={4}
                lineDashPattern={[6, 8]}
              />
              <Marker
                coordinate={{ latitude: arrowLat, longitude: arrowLng }}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={6}
                tracksViewChanges={false}
              >
                <View style={[styles.responseArrow, { transform: [{ rotate: `${angleDeg}deg` }] }]}>
                  <Text style={styles.responseArrowText}>➤</Text>
                </View>
              </Marker>
            </React.Fragment>
          );
        })}

        {visibleMarkers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.lat, longitude: marker.lng }}
            title={marker.label}
            description={marker.staleState ? `State: ${marker.staleState}` : marker.type}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={marker.type === "incident" ? 7 : marker.type === "paramedic" ? 6 : 5}
            onPress={() => {
              setSelectedMarkerId(marker.id);
              setActiveTab("map");
            }}
          >
            <View style={styles.dotMarkerContainer}>
              {marker.type === "incident" ? (
                <Animated.View
                  style={[
                    styles.incidentPulse,
                    {
                      opacity: incidentPulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.5, 0],
                      }),
                      transform: [
                        {
                          scale: incidentPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.8, 2],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ) : null}
              <View
                style={[
                  styles.dotMarker,
                  marker.type === "incident"
                    ? styles.dotIncident
                    : marker.type === "paramedic"
                      ? styles.dotParamedic
                      : styles.dotRunner,
                  marker.type === "incident"
                    ? styles.dotIncidentLarge
                    : marker.type === "paramedic"
                      ? styles.dotParamedicLarge
                      : null,
                ]}
              >
                {marker.type === "paramedic" ? (
                  <Text style={styles.paramedicInitials}>{markerInitials(marker.label)}</Text>
                ) : null}
              </View>
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={styles.topStrip}>
        <Text style={styles.topStripText}>MISSION: ACTIVE</Text>
        <Text style={styles.topStripText}>ACADEMY FIRST AID</Text>
      </View>

      {selectedMarker ? (
        <View style={styles.detailsSheet}>
          <Pressable style={styles.sheetCloseButton} onPress={() => setSelectedMarkerId(null)}>
            <Text style={styles.sheetCloseButtonText}>X</Text>
          </Pressable>
          <ScrollView contentContainerStyle={styles.detailsContent} showsVerticalScrollIndicator={false}>
            {selectedMarker.type === "runner" ? (
              <>
                <Text style={styles.sheetKicker}>PARTICIPANT</Text>
                <Text style={styles.sheetTitle}>{selectedMarker.name ?? selectedMarker.label}</Text>
                <Text style={styles.sheetBody}>Bib / Unit Number: {selectedMarker.bibNumber ?? "N/A"}</Text>
                <Text style={styles.sheetBody}>Freshness: {selectedMarker.staleState ?? "unknown"}</Text>
              </>
            ) : null}

            {selectedMarker.type === "paramedic" ? (
              <>
                <Text style={styles.sheetKicker}>RESPONDING UNIT</Text>
                <View style={styles.paramedicHeader}>
                  <Image
                    source={{ uri: selectedMarker.avatarUrl ?? "https://i.pravatar.cc/120?img=18" }}
                    style={styles.avatar}
                  />
                  <View style={styles.paramedicMeta}>
                    <Text style={styles.sheetTitle}>{selectedMarker.name ?? selectedMarker.label}</Text>
                    <Text style={styles.sheetBody}>{selectedMarker.vehicle ?? "Rapid Response Vehicle"}</Text>
                    <Text style={styles.sheetBody}>Unit: {selectedMarker.bibNumber ?? selectedMarker.id}</Text>
                  </View>
                </View>
                <View style={styles.actionsRow}>
                  <Pressable style={styles.actionButton}>
                    <Text style={styles.actionButtonText}>Call</Text>
                  </Pressable>
                  <Pressable style={styles.actionButtonSecondary}>
                    <Text style={styles.actionButtonSecondaryText}>Respond to Incident</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            {selectedMarker.type === "incident" ? (
              <>
                <Text style={styles.sheetKicker}>INCIDENT</Text>
                <Text style={styles.sheetTitle}>{selectedMarker.label}</Text>
                <Text style={styles.sheetBody}>{selectedMarker.description ?? "No description available."}</Text>
                <Text style={styles.sheetSectionTitle}>Responding Paramedics</Text>
                {(selectedMarker.respondingParamedicIds ?? []).length > 0 ? (
                  (selectedMarker.respondingParamedicIds ?? []).map((paramedicId) => {
                    const responder = markerById.get(paramedicId);
                    return (
                      <Text key={paramedicId} style={styles.sheetBody}>
                        • {responder?.name ?? responder?.label ?? paramedicId}
                      </Text>
                    );
                  })
                ) : (
                  <Text style={styles.sheetBody}>• None assigned yet.</Text>
                )}
              </>
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.bottomMenu}>
        {[
          { id: "map", label: "MAP" },
          { id: "reports", label: "REPORTS" },
          { id: "units", label: "UNITS" },
          { id: "profile", label: "PROFILE" },
        ].map((tab) => (
          <Pressable key={tab.id} style={styles.bottomMenuItem} onPress={() => setActiveTab(tab.id as typeof activeTab)}>
            <Text style={[styles.bottomMenuText, activeTab === tab.id ? styles.bottomMenuTextActive : null]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  topStrip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 46,
    backgroundColor: "#1e232b",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(94, 208, 105, 0.24)",
    zIndex: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  topStripText: { color: "#5dd06c", fontSize: 12, fontWeight: "800", letterSpacing: 0.6 },
  dotMarkerContainer: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dotMarker: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  dotParamedicLarge: { width: 24, height: 24 },
  dotIncidentLarge: { width: 30, height: 30 },
  incidentPulse: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "rgba(220, 38, 38, 0.45)",
  },
  paramedicInitials: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
    textAlign: "center",
  },
  dotRunner: { backgroundColor: "#2563eb" },
  dotParamedic: { backgroundColor: "#16a34a" },
  dotIncident: { backgroundColor: "#dc2626" },
  responseArrow: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(34,197,94,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ffffff",
  },
  responseArrowText: { color: "#ffffff", fontSize: 11, fontWeight: "800", lineHeight: 12 },
  detailsSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 58,
    height: "33%",
    backgroundColor: "#2d3139",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    zIndex: 9,
    borderTopWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
  },
  detailsContent: {
    padding: 14,
    paddingTop: 42,
    paddingBottom: 26,
    gap: 8,
  },
  sheetCloseButton: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(15,23,42,0.65)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  sheetCloseButtonText: { color: "#e2e8f0", fontSize: 14, fontWeight: "800" },
  sheetKicker: { color: "#58cd67", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  sheetTitle: { color: "#f1f5f9", fontSize: 22, fontWeight: "800", marginTop: 2 },
  sheetBody: { color: "#c8d0dc", fontSize: 14, marginTop: 6 },
  sheetSectionTitle: { color: "#8ea3ba", fontSize: 12, marginTop: 10, fontWeight: "700" },
  paramedicHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  avatar: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: "rgba(148,163,184,0.4)" },
  paramedicMeta: { flex: 1 },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionButton: {
    flex: 1,
    backgroundColor: "#4fbe5f",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  actionButtonText: { color: "#0f2110", fontWeight: "800", fontSize: 13 },
  actionButtonSecondary: {
    flex: 1.4,
    backgroundColor: "rgba(79,190,95,0.2)",
    borderColor: "#4fbe5f",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  actionButtonSecondaryText: { color: "#8cf299", fontWeight: "800", fontSize: 12 },
  bottomMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 58,
    backgroundColor: "#2a2f37",
    borderTopWidth: 1,
    borderColor: "rgba(94,208,105,0.2)",
    flexDirection: "row",
    zIndex: 10,
  },
  bottomMenuItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  bottomMenuText: { color: "#7f8da0", fontSize: 11, fontWeight: "700" },
  bottomMenuTextActive: { color: "#58cd67" },
});
