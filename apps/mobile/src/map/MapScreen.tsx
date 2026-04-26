import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ExpoLocation from "expo-location";
import MapView, { Circle, Marker, Polyline, UrlTile } from "react-native-maps";
import { getSocket } from "../realtime/socket-client";
import { apiFetch } from "../ui/api-client";
import { getMapyTilesTemplateUrl } from "./mapy-config";
import { useMapStore } from "./map-store";

const CURRENT_USER_ID = "mobile-user";
const FALLBACK_LAT = 42.6977;
const FALLBACK_LNG = 23.3219;
const SHEET_HIDDEN_Y = 420;
const SHEET_COLLAPSED_Y = 0;
const SHEET_EXPANDED_Y = -210;

type AppViewMode = "runner" | "paramedic";
type IncidentTab = "details" | "responders";

interface EventTrackResponse {
  id: string;
  label: string;
  points: Array<{ lat: number; lng: number }>;
  elevationProfile?: {
    totalAscentMeters: number;
    totalDescentMeters: number;
    maxElevationMeters: number | null;
    minElevationMeters: number | null;
    segmentSlopes: number[];
    sections: Array<{
      type: "climb" | "descent";
      startIndex: number;
      endIndex: number;
      distanceMeters: number;
      elevationChangeMeters: number;
    }>;
  };
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

interface LayerVisibility {
  participants: boolean;
  participantsHeatmap: boolean;
  paramedics: boolean;
  incidents: boolean;
}

interface HeatSpot {
  key: string;
  lat: number;
  lng: number;
  count: number;
}

interface TrackVisual {
  id: string;
  label: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
  color: string;
  gradientSegments: Array<{ coordinates: Array<{ latitude: number; longitude: number }>; color: string }>;
}

interface RegionLike {
  longitudeDelta: number;
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
  lineOffsetMeters: number,
): Array<{ latitude: number; longitude: number }> {
  if (points.length === 0 || lineOffsetMeters === 0) {
    return points.map((point) => ({ latitude: point.lat, longitude: point.lng }));
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const metersPerDegreeLat = 111_132;
  let fallbackEastNormal = 0;
  let fallbackNorthNormal = 1;

  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const avgLatRad = toRadians((prev.lat + next.lat) / 2);
    const metersPerDegreeLng = Math.max(1, 111_320 * Math.cos(avgLatRad));

    const tangentEastMeters = (next.lng - prev.lng) * metersPerDegreeLng;
    const tangentNorthMeters = (next.lat - prev.lat) * metersPerDegreeLat;
    const tangentLength = Math.hypot(tangentEastMeters, tangentNorthMeters);

    let rightEastNormal = fallbackEastNormal;
    let rightNorthNormal = fallbackNorthNormal;
    if (tangentLength > 0.001) {
      rightEastNormal = tangentNorthMeters / tangentLength;
      rightNorthNormal = -tangentEastMeters / tangentLength;
      fallbackEastNormal = rightEastNormal;
      fallbackNorthNormal = rightNorthNormal;
    }

    const eastOffsetMeters = rightEastNormal * lineOffsetMeters;
    const northOffsetMeters = rightNorthNormal * lineOffsetMeters;

    return {
      latitude: point.lat + northOffsetMeters / metersPerDegreeLat,
      longitude: point.lng + eastOffsetMeters / metersPerDegreeLng,
    };
  });
}

function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function trackColor(trackId: string): string {
  if (trackId.includes("10")) {
    return "#22c55e";
  }
  if (trackId.includes("21")) {
    return "#7c63ff";
  }
  if (trackId.includes("42")) {
    return "#ff3d61";
  }
  return "#14b8a6";
}

function mixHexColor(baseHex: string, mixHex: string, ratio: number): string {
  const clampRatio = Math.max(0, Math.min(1, ratio));
  const base = baseHex.replace("#", "");
  const mix = mixHex.replace("#", "");
  const baseInt = Number.parseInt(base, 16);
  const mixInt = Number.parseInt(mix, 16);
  const baseR = (baseInt >> 16) & 0xff;
  const baseG = (baseInt >> 8) & 0xff;
  const baseB = baseInt & 0xff;
  const mixR = (mixInt >> 16) & 0xff;
  const mixG = (mixInt >> 8) & 0xff;
  const mixB = mixInt & 0xff;

  const red = Math.round(baseR + (mixR - baseR) * clampRatio);
  const green = Math.round(baseG + (mixG - baseG) * clampRatio);
  const blue = Math.round(baseB + (mixB - baseB) * clampRatio);
  return `rgb(${red}, ${green}, ${blue})`;
}

function slopeColor(baseColor: string, normalizedSlope: number): string {
  if (normalizedSlope > 0) {
    return mixHexColor(baseColor, "#0b1628", Math.min(0.58, normalizedSlope * 0.58));
  }
  if (normalizedSlope < 0) {
    return mixHexColor(baseColor, "#f1f5f9", Math.min(0.58, Math.abs(normalizedSlope) * 0.58));
  }
  return baseColor;
}

function buildGradientSegments(
  coordinates: Array<{ latitude: number; longitude: number }>,
  slopes: number[],
  baseColor: string,
): Array<{ coordinates: Array<{ latitude: number; longitude: number }>; color: string }> {
  if (coordinates.length < 2) {
    return [];
  }

  const segmentCount = coordinates.length - 1;
  const effectiveSlopes =
    slopes.length === segmentCount
      ? slopes
      : Array.from({ length: segmentCount }, () => 0);

  const segments: Array<{ coordinates: Array<{ latitude: number; longitude: number }>; color: string }> = [];
  let chunkStart = 0;
  let bucket = Math.round((effectiveSlopes[0] ?? 0) * 7);
  let chunkColor = slopeColor(baseColor, (effectiveSlopes[0] ?? 0));

  for (let index = 1; index < segmentCount; index += 1) {
    const slope = effectiveSlopes[index] ?? 0;
    const nextBucket = Math.round(slope * 7);
    if (nextBucket === bucket) {
      continue;
    }

    segments.push({
      coordinates: coordinates.slice(chunkStart, index + 1),
      color: chunkColor,
    });

    chunkStart = index;
    bucket = nextBucket;
    chunkColor = slopeColor(baseColor, slope);
  }

  segments.push({
    coordinates: coordinates.slice(chunkStart, coordinates.length),
    color: chunkColor,
  });

  return segments;
}

function trackOffsetStepMetersForZoom(zoom: number): number {
  if (zoom <= 10) {
    return 80;
  }
  const clamped = Math.max(11, Math.min(15, zoom));
  const t = (clamped - 11) / 4;
  return Math.round(30 - t * 20);
}

function approximateZoomFromRegion(region: RegionLike): number {
  const delta = Math.max(0.000001, region.longitudeDelta);
  return Math.log2(360 / delta);
}

function buildTrackVisuals(tracks: EventTrackResponse[], trackOffsetStepMeters: number): TrackVisual[] {
  if (tracks.length === 0) {
    return [];
  }

  return tracks.map((track, index) => {
    const centerIndex = (tracks.length - 1) / 2;
    const offsetFactor = index - centerIndex;
    const lineOffsetMeters = offsetFactor * trackOffsetStepMeters;
    const coordinates = offsetTrackCoordinates(track.points, lineOffsetMeters);
    const baseColor = trackColor(track.id);

    return {
      id: track.id,
      label: track.label,
      coordinates,
      color: baseColor,
      gradientSegments: buildGradientSegments(
        coordinates,
        track.elevationProfile?.segmentSlopes ?? [],
        baseColor,
      ),
    };
  });
}

function buildHeatSpots(runners: Array<{ id: string; lat: number; lng: number }>): HeatSpot[] {
  const cells = new Map<string, { latSum: number; lngSum: number; count: number }>();

  for (const runner of runners) {
    const gridLat = Math.round(runner.lat * 420);
    const gridLng = Math.round(runner.lng * 420);
    const key = `${gridLat}:${gridLng}`;
    const existing = cells.get(key);

    if (!existing) {
      cells.set(key, { latSum: runner.lat, lngSum: runner.lng, count: 1 });
      continue;
    }

    existing.latSum += runner.lat;
    existing.lngSum += runner.lng;
    existing.count += 1;
  }

  return Array.from(cells.entries())
    .map(([key, cell]) => ({
      key,
      lat: cell.latSum / cell.count,
      lng: cell.lngSum / cell.count,
      count: cell.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 90);
}

function heatRampColor(normalized: number): string {
  const value = Math.max(0, Math.min(1, normalized));
  if (value < 0.2) return "rgba(33,102,172,0.22)";
  if (value < 0.4) return "rgba(103,169,207,0.26)";
  if (value < 0.6) return "rgba(166,217,106,0.3)";
  if (value < 0.8) return "rgba(253,174,97,0.35)";
  return "rgba(215,48,39,0.4)";
}

export function MapScreen({ viewMode }: { viewMode: AppViewMode }) {
  const markers = useMapStore((state) => state.markers);
  const tracks = useMapStore((state) => state.tracks);
  const centerOnUserRequestId = useMapStore((state) => state.centerOnUserRequestId);
  const resetNorthRequestId = useMapStore((state) => state.resetNorthRequestId);
  const setMarkers = useMapStore((state) => state.setMarkers);
  const setTracks = useMapStore((state) => state.setTracks);

  const mapRef = useRef<MapView | null>(null);
  const incidentPulse = useRef(new Animated.Value(0)).current;
  const sheetBaseTranslate = useRef(new Animated.Value(SHEET_HIDDEN_Y)).current;
  const sheetDragTranslate = useRef(new Animated.Value(0)).current;
  const sheetBaseValueRef = useRef(SHEET_HIDDEN_Y);

  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [incidentTab, setIncidentTab] = useState<IncidentTab>("details");
  const [activeTab, setActiveTab] = useState<"map" | "reports" | "units" | "profile">("map");
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapZoom, setMapZoom] = useState(13);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({
    participants: false,
    participantsHeatmap: true,
    paramedics: true,
    incidents: true,
  });

  const mapyTilesTemplateUrl = getMapyTilesTemplateUrl();

  const animateSheetTo = (toValue: number) => {
    sheetBaseValueRef.current = toValue;
    Animated.spring(sheetBaseTranslate, {
      toValue,
      damping: 28,
      mass: 1,
      stiffness: 280,
      useNativeDriver: true,
    }).start();
  };

  const sheetPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => {
        return Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx);
      },
      onPanResponderMove: (_event, gesture) => {
        sheetDragTranslate.setValue(gesture.dy);
      },
      onPanResponderRelease: (_event, gesture) => {
        const projected = sheetBaseValueRef.current + gesture.dy + gesture.vy * 34;
        const target = projected < -105 ? SHEET_EXPANDED_Y : SHEET_COLLAPSED_Y;
        sheetDragTranslate.setValue(0);
        animateSheetTo(target);
      },
      onPanResponderTerminate: () => {
        sheetDragTranslate.setValue(0);
        animateSheetTo(sheetBaseValueRef.current);
      },
    }),
  ).current;

  const sheetTranslateY = Animated.add(sheetBaseTranslate, sheetDragTranslate).interpolate({
    inputRange: [SHEET_EXPANDED_Y, SHEET_HIDDEN_Y],
    outputRange: [SHEET_EXPANDED_Y, SHEET_HIDDEN_Y],
    extrapolate: "clamp",
  });

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 650);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(incidentPulse, {
          toValue: 1,
          duration: 960,
          easing: Easing.inOut(Easing.quad),
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
    return () => animation.stop();
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
        ].slice(-2200),
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
        ].slice(-2200),
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
        { duration: 360 },
      );
    };

    if (resetNorthRequestId > 0) {
      void resetNorth();
    }
  }, [resetNorthRequestId]);

  const nonCurrentMarkers = useMemo(
    () => markers.filter((marker) => marker.id !== CURRENT_USER_ID),
    [markers],
  );

  const markerById = useMemo(
    () => new Map(nonCurrentMarkers.map((marker) => [marker.id, marker])),
    [nonCurrentMarkers],
  );

  const runners = useMemo(
    () => nonCurrentMarkers.filter((marker) => marker.type === "runner"),
    [nonCurrentMarkers],
  );

  const visibleMarkers = useMemo(
    () =>
      nonCurrentMarkers.filter((marker) => {
        if (marker.type === "runner") {
          return layerVisibility.participants;
        }
        if (marker.type === "paramedic") {
          return layerVisibility.paramedics;
        }
        if (marker.type === "incident") {
          return layerVisibility.incidents;
        }
        return false;
      }),
    [layerVisibility.incidents, layerVisibility.paramedics, layerVisibility.participants, nonCurrentMarkers],
  );

  const heatSpots = useMemo(() => buildHeatSpots(runners), [runners]);
  const trackOffsetStepMeters = useMemo(() => trackOffsetStepMetersForZoom(mapZoom), [mapZoom]);
  const trackVisuals = useMemo(
    () => buildTrackVisuals(tracks, trackOffsetStepMeters),
    [tracks, trackOffsetStepMeters],
  );
  const maxHeatSpotCount = useMemo(
    () => heatSpots.reduce((maxValue, spot) => Math.max(maxValue, spot.count), 0),
    [heatSpots],
  );

  const respondingParamedics = useMemo(
    () =>
      nonCurrentMarkers.filter(
        (marker) =>
          marker.type === "paramedic" &&
          Boolean(marker.respondingIncidentId) &&
          layerVisibility.paramedics &&
          layerVisibility.incidents,
      ),
    [layerVisibility.incidents, layerVisibility.paramedics, nonCurrentMarkers],
  );

  const selectedMarker = selectedMarkerId ? markerById.get(selectedMarkerId) : undefined;
  const selectedIncident = selectedMarker?.type === "incident" ? selectedMarker : undefined;

  useEffect(() => {
    if (selectedIncident) {
      sheetDragTranslate.setValue(0);
      animateSheetTo(SHEET_COLLAPSED_Y);
      return;
    }

    sheetDragTranslate.setValue(0);
    animateSheetTo(SHEET_HIDDEN_Y);
  }, [selectedIncident, sheetDragTranslate]);

  const closeSelection = () => {
    setSelectedMarkerId(null);
    setIncidentTab("details");
  };

  const toggleLayer = (key: keyof LayerVisibility) => {
    setLayerVisibility((state) => ({
      ...state,
      [key]: !state[key],
    }));
  };

  const centerOnCurrentPosition = async () => {
    const permission = await ExpoLocation.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      return;
    }

    const location = await ExpoLocation.getCurrentPositionAsync({});
    mapRef.current?.animateToRegion(
      {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      420,
    );
  };

  const resetMapNorth = async () => {
    const camera = await mapRef.current?.getCamera();
    if (!camera) {
      return;
    }

    mapRef.current?.animateCamera(
      {
        ...camera,
        heading: 0,
      },
      { duration: 340 },
    );
  };

  const incidentDistance = selectedIncident
    ? distanceKm(FALLBACK_LAT, FALLBACK_LNG, selectedIncident.lat, selectedIncident.lng)
    : 0;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={mapyTilesTemplateUrl ? "none" : "standard"}
        showsUserLocation
        followsUserLocation
        onRegionChangeComplete={(region) => {
          setMapZoom(approximateZoomFromRegion(region));
        }}
        initialRegion={{
          latitude: FALLBACK_LAT,
          longitude: FALLBACK_LNG,
          latitudeDelta: 0.07,
          longitudeDelta: 0.07,
        }}
      >
        {mapyTilesTemplateUrl ? (
          <UrlTile urlTemplate={mapyTilesTemplateUrl} maximumZ={19} flipY={false} zIndex={0} />
        ) : null}

        {trackVisuals.map((track) => (
          <React.Fragment key={`track-${track.id}`}>
            <Polyline
              coordinates={track.coordinates}
              strokeColor="rgba(6, 15, 28, 0.82)"
              strokeWidth={10}
              zIndex={2}
            />
            {track.gradientSegments.length > 0 ? (
              track.gradientSegments.map((segment, index) => (
                <Polyline
                  key={`${track.id}-segment-${index}`}
                  coordinates={segment.coordinates}
                  strokeColor={segment.color}
                  strokeWidth={6.4}
                  zIndex={3}
                />
              ))
            ) : (
              <Polyline
                coordinates={track.coordinates}
                strokeColor={track.color}
                strokeWidth={6.4}
                zIndex={3}
              />
            )}
          </React.Fragment>
        ))}

        {layerVisibility.participantsHeatmap
          ? heatSpots.map((spot) => {
              const normalized = maxHeatSpotCount > 0 ? spot.count / maxHeatSpotCount : 0;
              const radiusOuter = 56 + normalized * 120;
              const radiusMid = 24 + normalized * 66;
              const radiusCore = 9 + normalized * 26;
              const colorOuter = heatRampColor(normalized * 0.72);
              const colorMid = heatRampColor(Math.min(1, normalized * 0.9));
              const colorCore = heatRampColor(Math.min(1, normalized + 0.22));

              return (
                <React.Fragment key={`heat-${spot.key}`}>
                  <Circle
                    center={{ latitude: spot.lat, longitude: spot.lng }}
                    radius={radiusOuter}
                    fillColor={colorOuter}
                    strokeColor="transparent"
                    strokeWidth={0}
                    zIndex={1}
                  />
                  <Circle
                    center={{ latitude: spot.lat, longitude: spot.lng }}
                    radius={radiusMid}
                    fillColor={colorMid}
                    strokeColor="transparent"
                    strokeWidth={0}
                    zIndex={1}
                  />
                  <Circle
                    center={{ latitude: spot.lat, longitude: spot.lng }}
                    radius={radiusCore}
                    fillColor={colorCore}
                    strokeColor="transparent"
                    strokeWidth={0}
                    zIndex={1}
                  />
                </React.Fragment>
              );
            })
          : null}

        {respondingParamedics.map((paramedic, index) => {
          const incident = paramedic.respondingIncidentId ? markerById.get(paramedic.respondingIncidentId) : undefined;
          if (!incident || incident.type !== "incident") {
            return null;
          }

          const progress = ((tick * 0.11 + index * 0.19) % 1 + 1) % 1;
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
                strokeColor="rgba(91, 221, 117, 0.9)"
                strokeWidth={4}
                lineDashPattern={[5, 8]}
                zIndex={5}
              />
              <Marker
                coordinate={{ latitude: arrowLat, longitude: arrowLng }}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={7}
                tracksViewChanges={false}
              >
                <View style={[styles.responseArrow, { transform: [{ rotate: `${angleDeg}deg` }] }]}>
                  <Text style={styles.responseArrowText}>{">"}</Text>
                </View>
              </Marker>
            </React.Fragment>
          );
        })}

        {visibleMarkers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.lat, longitude: marker.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={marker.type === "incident" ? 10 : marker.type === "paramedic" ? 9 : 6}
            onPress={() => {
              setSelectedMarkerId(marker.id);
              if (marker.type === "incident") {
                setIncidentTab("details");
              }
            }}
          >
            {marker.type === "incident" ? (
              <View style={styles.incidentMarkerWrap}>
                <Animated.View
                  style={[
                    styles.incidentPulse,
                    {
                      opacity: incidentPulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.55, 0],
                      }),
                      transform: [
                        {
                          scale: incidentPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.85, 1.85],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <View style={styles.incidentMarkerBadge}>
                  <View style={styles.incidentIconWrapSmall}>
                    <Text style={styles.incidentIconSmallText}>!</Text>
                  </View>
                  <Text style={styles.incidentMarkerText}>INCIDENT</Text>
                </View>
              </View>
            ) : null}

            {marker.type === "paramedic" ? (
              <View style={styles.paramedicMarkerBadge}>
                <View style={styles.paramedicIconWrap}>
                  <Text style={styles.paramedicIconText}>+</Text>
                </View>
                <Text style={styles.paramedicMarkerText}>{markerInitials(marker.label)}</Text>
              </View>
            ) : null}

            {marker.type === "runner" ? <View style={styles.runnerDot} /> : null}
          </Marker>
        ))}
      </MapView>

      {menuOpen ? <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} /> : null}

      <View style={styles.missionStrip}>
        <Text style={styles.missionStripText}>MISSION: ACTIVE</Text>
        <Text style={styles.missionStripText}>ACADEMY FIRST AID</Text>
      </View>

      <View style={styles.topHeader}>
        <Pressable style={styles.menuButton} onPress={() => setMenuOpen((open) => !open)}>
          <Text style={styles.menuButtonText}>MENU</Text>
        </Pressable>

        <View style={styles.eventChip}>
          <View style={styles.eventHeaderRow}>
            <Text style={styles.eventTitle}>IRON PEAK MARATHON</Text>
            <Text style={styles.eventCaret}>v</Text>
          </View>
          <View style={styles.eventMetaRow}>
            <Text style={styles.livePill}>LIVE</Text>
            <Text style={styles.eventMetaText}>02:45:18</Text>
            <Text style={styles.eventMetaText}>{viewMode.toUpperCase()}</Text>
          </View>
        </View>

        <Pressable style={styles.iconButton} onPress={centerOnCurrentPosition}>
          <Text style={styles.iconButtonText}>GPS</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={styles.menuPopup}>
          <Text style={styles.menuPopupTitle}>Layers</Text>

          <Pressable style={styles.layerRow} onPress={() => toggleLayer("participants")}>
            <Text style={styles.layerLabel}>Participants (individual)</Text>
            <View style={[styles.switchTrack, layerVisibility.participants ? styles.switchTrackOn : null]}>
              <View style={[styles.switchKnob, layerVisibility.participants ? styles.switchKnobOn : null]} />
            </View>
          </Pressable>

          <Pressable style={styles.layerRow} onPress={() => toggleLayer("participantsHeatmap")}>
            <Text style={styles.layerLabel}>Participants heatmap</Text>
            <View style={[styles.switchTrack, layerVisibility.participantsHeatmap ? styles.switchTrackOn : null]}>
              <View style={[styles.switchKnob, layerVisibility.participantsHeatmap ? styles.switchKnobOn : null]} />
            </View>
          </Pressable>

          <Pressable style={styles.layerRow} onPress={() => toggleLayer("paramedics")}>
            <Text style={styles.layerLabel}>Paramedics</Text>
            <View style={[styles.switchTrack, layerVisibility.paramedics ? styles.switchTrackOn : null]}>
              <View style={[styles.switchKnob, layerVisibility.paramedics ? styles.switchKnobOn : null]} />
            </View>
          </Pressable>

          <Pressable style={styles.layerRow} onPress={() => toggleLayer("incidents")}>
            <Text style={styles.layerLabel}>Incidents</Text>
            <View style={[styles.switchTrack, layerVisibility.incidents ? styles.switchTrackOn : null]}>
              <View style={[styles.switchKnob, layerVisibility.incidents ? styles.switchKnobOn : null]} />
            </View>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.rightControls}>
        <Pressable style={styles.fab} onPress={resetMapNorth}>
          <Text style={styles.fabText}>N</Text>
        </Pressable>
        <Pressable style={styles.fab} onPress={centerOnCurrentPosition}>
          <Text style={styles.fabText}>ME</Text>
        </Pressable>
      </View>

      <View style={styles.leftControls}>
        <Pressable style={styles.actionPill} onPress={centerOnCurrentPosition}>
          <Text style={styles.actionPillText}>CENTER ON ME</Text>
        </Pressable>
        <Pressable style={styles.actionPill}>
          <Text style={styles.actionPillText}>NEARBY UNITS</Text>
        </Pressable>
      </View>

      {selectedMarker && !selectedIncident ? (
        <View style={styles.selectionCard}>
          <Pressable style={styles.selectionClose} onPress={closeSelection}>
            <Text style={styles.selectionCloseText}>X</Text>
          </Pressable>
          <Text style={styles.selectionKicker}>{selectedMarker.type === "paramedic" ? "RESPONDING UNIT" : "PARTICIPANT"}</Text>
          <Text style={styles.selectionTitle}>{selectedMarker.name ?? selectedMarker.label}</Text>
          <Text style={styles.selectionMeta}>
            {selectedMarker.type === "paramedic"
              ? `${selectedMarker.vehicle ?? "Mobile Unit"} | ${selectedMarker.bibNumber ?? selectedMarker.id}`
              : `Bib ${selectedMarker.bibNumber ?? "N/A"}`}
          </Text>
        </View>
      ) : null}

      <Animated.View
        pointerEvents={selectedIncident ? "auto" : "none"}
        style={[
          styles.incidentSheet,
          {
            transform: [{ translateY: sheetTranslateY }],
            opacity: sheetBaseTranslate.interpolate({
              inputRange: [SHEET_COLLAPSED_Y, SHEET_HIDDEN_Y],

              outputRange: [0, 1],
              extrapolate: "clamp",
            }),
          },
        ]}
      >
        {selectedIncident ? (
          <>
            <View {...sheetPanResponder.panHandlers} style={styles.sheetDragZone}>
              <View style={styles.sheetHandle} />
            </View>

            <View style={styles.sheetHeader}>
              <View style={styles.incidentIconWrap}>
                <Text style={styles.incidentIconText}>!</Text>
              </View>
              <View style={styles.sheetHeaderTextWrap}>
                <Text style={styles.sheetTitle}>{selectedIncident.label}</Text>
                <Text style={styles.sheetMetaText}>Injury | Reported live</Text>
                <Text style={styles.sheetMetaText}>{incidentDistance.toFixed(1)} km from your location</Text>
              </View>

              <Pressable style={styles.sheetCloseButton} onPress={closeSelection}>
                <Text style={styles.sheetCloseButtonText}>X</Text>
              </Pressable>
            </View>

            <View style={styles.sheetTabs}>
              <Pressable style={styles.sheetTabButton} onPress={() => setIncidentTab("details")}>
                <Text style={[styles.sheetTabText, incidentTab === "details" ? styles.sheetTabTextActive : null]}>DETAILS</Text>
                {incidentTab === "details" ? <View style={styles.sheetTabUnderline} /> : null}
              </Pressable>
              <Pressable style={styles.sheetTabButton} onPress={() => setIncidentTab("responders")}>
                <Text style={[styles.sheetTabText, incidentTab === "responders" ? styles.sheetTabTextActive : null]}>
                  RESPONDERS ({(selectedIncident.respondingParamedicIds ?? []).length})
                </Text>
                {incidentTab === "responders" ? <View style={styles.sheetTabUnderline} /> : null}
              </Pressable>
            </View>

            <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} showsVerticalScrollIndicator={false}>
              {incidentTab === "details" ? (
                <>
                  <View style={styles.sheetInfoRow}>
                    <Text style={styles.sheetInfoLabel}>Trail section</Text>
                    <Text style={styles.sheetInfoValue}>Red Hill Descent</Text>
                  </View>
                  <View style={styles.sheetInfoRow}>
                    <Text style={styles.sheetInfoLabel}>Incident notes</Text>
                    <Text style={styles.sheetInfoValue}>{selectedIncident.description ?? "Runner collapsed after hard descent."}</Text>
                  </View>
                </>
              ) : (
                <>
                  {(selectedIncident.respondingParamedicIds ?? []).length > 0 ? (
                    (selectedIncident.respondingParamedicIds ?? []).map((paramedicId) => {
                      const responder = markerById.get(paramedicId);
                      return (
                        <View key={paramedicId} style={styles.responderRow}>
                          <View>
                            <Text style={styles.responderName}>{responder?.name ?? responder?.label ?? paramedicId}</Text>
                            <Text style={styles.responderMeta}>{responder?.vehicle ?? "Medical Unit"}</Text>
                          </View>
                          <Pressable style={styles.messageButton}>
                            <Text style={styles.messageButtonText}>Message</Text>
                          </Pressable>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.sheetInfoValue}>No responders assigned yet.</Text>
                  )}
                </>
              )}
            </ScrollView>

            <View style={styles.sheetActions}>
              <Pressable style={styles.sheetSecondaryAction}>
                <Text style={styles.sheetSecondaryActionText}>Call for backup</Text>
              </Pressable>
              <Pressable style={styles.sheetSecondaryAction}>
                <Text style={styles.sheetSecondaryActionText}>Need more help</Text>
              </Pressable>
              <Pressable style={styles.sheetPrimaryAction}>
                <Text style={styles.sheetPrimaryActionText}>Update incident</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </Animated.View>

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
  container: { flex: 1, backgroundColor: "#020b18" },
  map: { flex: 1 },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18,
    backgroundColor: "rgba(0, 0, 0, 0.12)",
  },
  missionStrip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 40,
    zIndex: 20,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  missionStripText: {
    color: "#5fdf7a",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  topHeader: {
    position: "absolute",
    top: 45,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 21,
    gap: 8,
  },
  menuButton: {
    minWidth: 66,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  menuButtonText: {
    color: "#eff6ff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  eventChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: "center",
  },
  eventHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eventTitle: {
    color: "#f2f8ff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  eventCaret: {
    color: "#acc0d9",
    fontSize: 11,
    fontWeight: "700",
  },
  eventMetaRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  livePill: {
    color: "#0f2b13",
    backgroundColor: "#69dd7b",
    fontSize: 10,
    fontWeight: "900",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  eventMetaText: {
    color: "#c2d0e2",
    fontSize: 11,
    fontWeight: "600",
  },
  iconButton: {
    width: 46,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(8, 15, 28, 0.93)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonText: {
    color: "#ecf4ff",
    fontSize: 11,
    fontWeight: "900",
  },
  menuPopup: {
    position: "absolute",
    top: 94,
    left: 12,
    width: 258,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.28)",
    backgroundColor: "rgba(8, 15, 28, 0.96)",
    zIndex: 24,
    padding: 12,
    gap: 10,
  },
  menuPopupTitle: {
    color: "#f1f7ff",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 2,
  },
  layerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 30,
  },
  layerLabel: {
    color: "#d8e3f1",
    fontSize: 12,
    fontWeight: "600",
  },
  switchTrack: {
    width: 42,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.35)",
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  switchTrackOn: {
    backgroundColor: "rgba(104, 214, 121, 0.85)",
  },
  switchKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f1f5f9",
  },
  switchKnobOn: {
    alignSelf: "flex-end",
  },
  rightControls: {
    position: "absolute",
    right: 12,
    top: 190,
    zIndex: 20,
    gap: 8,
  },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: "rgba(8, 15, 28, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: {
    color: "#edf4ff",
    fontSize: 12,
    fontWeight: "900",
  },
  leftControls: {
    position: "absolute",
    left: 12,
    bottom: 94,
    zIndex: 20,
    gap: 8,
  },
  actionPill: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 15, 28, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.2)",
  },
  actionPillText: {
    color: "#ebf4ff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  incidentMarkerWrap: {
    width: 94,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  incidentMarkerBadge: {
    minHeight: 34,
    minWidth: 86,
    borderRadius: 11,
    backgroundColor: "rgba(9, 16, 30, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(255, 111, 111, 0.65)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 9,
    gap: 6,
  },
  incidentIconWrapSmall: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
  },
  incidentIconSmallText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 12,
  },
  incidentMarkerText: {
    color: "#ffd2d2",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  incidentPulse: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 24,
    backgroundColor: "rgba(255, 58, 92, 0.45)",
  },
  paramedicMarkerBadge: {
    minHeight: 30,
    minWidth: 64,
    borderRadius: 999,
    backgroundColor: "rgba(8, 25, 18, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(125, 233, 145, 0.72)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    gap: 5,
  },
  paramedicIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#22c55e",
    alignItems: "center",
    justifyContent: "center",
  },
  paramedicIconText: {
    color: "#05330f",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 12,
  },
  paramedicMarkerText: {
    color: "#d4ffe0",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  runnerDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: "#3b82f6",
    borderWidth: 1,
    borderColor: "#ffffff",
  },
  responseArrow: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(34,197,94,0.95)",
    borderWidth: 1,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  responseArrowText: {
    color: "#f8fafc",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 11,
  },
  selectionCard: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 72,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.28)",
    backgroundColor: "rgba(6, 16, 34, 0.95)",
    padding: 14,
    zIndex: 22,
  },
  selectionClose: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 31, 49, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(190, 206, 224, 0.35)",
  },
  selectionCloseText: {
    color: "#dce8f6",
    fontSize: 12,
    fontWeight: "900",
  },
  selectionKicker: {
    color: "#6fe684",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  selectionTitle: {
    color: "#f4f8ff",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 3,
  },
  selectionMeta: {
    marginTop: 4,
    color: "#a9bdd4",
    fontSize: 13,
    fontWeight: "600",
  },
  incidentSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 60,
    height: "76%",
    backgroundColor: "rgba(4, 11, 24, 0.985)",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: "rgba(180, 201, 223, 0.28)",
    zIndex: 30,
  },
  sheetDragZone: {
    width: "100%",
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetHandle: {
    width: 52,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(150, 171, 196, 0.62)",
  },
  sheetHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 4,
    alignItems: "center",
  },
  incidentIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  incidentIconText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 24,
  },
  sheetHeaderTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  sheetTitle: {
    color: "#f4f8ff",
    fontSize: 29,
    fontWeight: "800",
  },
  sheetMetaText: {
    color: "#a8bbd2",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  sheetCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(24, 38, 58, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(192, 210, 228, 0.36)",
  },
  sheetCloseButtonText: {
    color: "#e2edf8",
    fontSize: 13,
    fontWeight: "900",
  },
  sheetTabs: {
    marginTop: 12,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(177, 199, 224, 0.18)",
  },
  sheetTabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
  },
  sheetTabText: {
    color: "#8da5c0",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  sheetTabTextActive: {
    color: "#f1f7ff",
  },
  sheetTabUnderline: {
    marginTop: 8,
    width: "72%",
    height: 2,
    borderRadius: 2,
    backgroundColor: "#f25656",
  },
  sheetBody: {
    flex: 1,
  },
  sheetBodyContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  sheetInfoRow: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(177, 199, 224, 0.16)",
    paddingBottom: 10,
  },
  sheetInfoLabel: {
    color: "#96adc7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  sheetInfoValue: {
    color: "#e4edf8",
    fontSize: 14,
    lineHeight: 20,
  },
  responderRow: {
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.2)",
    backgroundColor: "rgba(15, 29, 48, 0.74)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  responderName: {
    color: "#f1f7ff",
    fontSize: 14,
    fontWeight: "800",
  },
  responderMeta: {
    color: "#9ab0c8",
    fontSize: 12,
    marginTop: 2,
  },
  messageButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f35c5c",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messageButtonText: {
    color: "#f9b0b0",
    fontSize: 12,
    fontWeight: "700",
  },
  sheetActions: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(177, 199, 224, 0.15)",
  },
  sheetSecondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(177, 199, 224, 0.32)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10, 23, 40, 0.82)",
  },
  sheetSecondaryActionText: {
    color: "#d8e5f5",
    fontSize: 12,
    fontWeight: "700",
  },
  sheetPrimaryAction: {
    flex: 1.2,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#de4747",
  },
  sheetPrimaryActionText: {
    color: "#fff2f2",
    fontSize: 13,
    fontWeight: "900",
  },
  bottomMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
    flexDirection: "row",
    backgroundColor: "rgba(7, 15, 29, 0.98)",
    borderTopWidth: 1,
    borderTopColor: "rgba(177, 199, 224, 0.2)",
    zIndex: 40,
  },
  bottomMenuItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomMenuText: {
    color: "#8ea5bf",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  bottomMenuTextActive: {
    color: "#61df7d",
  },
});
