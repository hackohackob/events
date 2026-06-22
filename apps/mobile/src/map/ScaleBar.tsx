import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Small, unobtrusive map scale bar ("мащаб") — the ruler maps usually show.
 * Computes metres-per-pixel from the current MapLibre/Mapbox-GL zoom and the
 * map-centre latitude, then snaps to a 1/2/5×10ⁿ "nice" distance and renders a
 * bar of the matching pixel width with a label. Purely presentational.
 */

const MAX_BAR_PX = 78; // the bar never grows past this; the label rounds down to fit

/** Web-Mercator metres per screen pixel at a given GL zoom + latitude. */
function metersPerPixel(zoom: number, latitude: number): number {
  const latRad = (latitude * Math.PI) / 180;
  return (156543.03392 * Math.cos(latRad)) / 2 ** zoom;
}

/** Largest 1/2/5×10ⁿ value ≤ max. */
function niceDistance(max: number): number {
  const pow = Math.floor(Math.log10(max));
  const base = 10 ** pow;
  const frac = max / base;
  const mult = frac >= 5 ? 5 : frac >= 2 ? 2 : 1;
  return mult * base;
}

function label(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

export function ScaleBar({ zoom, latitude }: { zoom: number; latitude: number }) {
  const { widthPx, text } = useMemo(() => {
    const mpp = metersPerPixel(zoom, latitude);
    if (!Number.isFinite(mpp) || mpp <= 0) return { widthPx: 0, text: "" };
    const meters = niceDistance(mpp * MAX_BAR_PX);
    return { widthPx: Math.max(1, Math.round(meters / mpp)), text: label(meters) };
  }, [zoom, latitude]);

  if (widthPx <= 0) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text style={styles.label}>{text}</Text>
      <View style={[styles.bar, { width: widthPx }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "flex-start" },
  label: {
    color: "rgba(233,242,255,0.85)",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 2,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 1 },
  },
  // Classic ruler "U-bracket": a baseline with upward end ticks.
  bar: {
    height: 6,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: "rgba(233,242,255,0.92)",
  },
});
