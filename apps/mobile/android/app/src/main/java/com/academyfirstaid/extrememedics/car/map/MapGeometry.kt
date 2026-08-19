package com.academyfirstaid.extrememedics.car.map

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Web-Mercator helpers for the car map.
 *
 * Everything is expressed in "world pixels" at a given zoom, where the whole
 * world is `TILE_SIZE * 2^zoom` pixels wide. Screen position is then just
 * `worldPixel - viewportOrigin`, which keeps the renderer free of trigonometry
 * on the hot path.
 */
object MapGeometry {

  /** Logical size of one tile in world pixels. The 2x tiles we fetch are 512 px
   *  images of this same 256 px tile, and are drawn scaled to match. */
  const val TILE_SIZE = 256.0

  const val MAX_LATITUDE = 85.05112878
  const val EARTH_RADIUS_M = 6_378_137.0

  fun worldSize(zoom: Double): Double = TILE_SIZE * Math.pow(2.0, zoom)

  fun lngToWorldX(lng: Double, zoom: Double): Double =
    (lng + 180.0) / 360.0 * worldSize(zoom)

  fun latToWorldY(lat: Double, zoom: Double): Double {
    val clamped = lat.coerceIn(-MAX_LATITUDE, MAX_LATITUDE)
    val rad = clamped * PI / 180.0
    val y = ln(tan(rad) + 1.0 / cos(rad))
    return (1.0 - y / PI) / 2.0 * worldSize(zoom)
  }

  fun worldXToLng(x: Double, zoom: Double): Double =
    x / worldSize(zoom) * 360.0 - 180.0

  fun worldYToLat(y: Double, zoom: Double): Double {
    val n = PI - 2.0 * PI * y / worldSize(zoom)
    return 180.0 / PI * atan(sinh(n))
  }

  /** Tile column containing `lng` at integer zoom `z`. */
  fun tileX(lng: Double, z: Int): Int =
    floor((lng + 180.0) / 360.0 * (1 shl z)).toInt()

  /** Tile row containing `lat` at integer zoom `z`. */
  fun tileY(lat: Double, z: Int): Int {
    val clamped = lat.coerceIn(-MAX_LATITUDE, MAX_LATITUDE)
    val rad = clamped * PI / 180.0
    return floor((1.0 - ln(tan(rad) + 1.0 / cos(rad)) / PI) / 2.0 * (1 shl z)).toInt()
  }

  /** Ground metres covered by one screen pixel at this latitude and zoom. */
  fun metersPerPixel(lat: Double, zoom: Double): Double =
    cos(lat * PI / 180.0) * 2.0 * PI * EARTH_RADIUS_M / worldSize(zoom)

  /** Great-circle distance in metres (haversine). */
  fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val dLat = (lat2 - lat1) * PI / 180.0
    val dLng = (lng2 - lng1) * PI / 180.0
    val a = sin(dLat / 2) * sin(dLat / 2) +
      cos(lat1 * PI / 180.0) * cos(lat2 * PI / 180.0) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * EARTH_RADIUS_M * atan2(sqrt(a), sqrt((1 - a).coerceAtLeast(0.0)))
  }

  /** Human distance for a car screen: no decimals anyone has to squint at. */
  fun formatDistance(meters: Double): String = when {
    meters < 10 -> "now"
    meters < 950 -> "${(meters / 10).toInt() * 10} m"
    meters < 9_500 -> String.format("%.1f km", meters / 1000.0)
    else -> "${(meters / 1000.0).toInt()} km"
  }

  fun formatDuration(ms: Long): String {
    val totalMinutes = (ms / 60_000L).toInt()
    if (totalMinutes < 1) return "< 1 min"
    if (totalMinutes < 60) return "$totalMinutes min"
    val hours = totalMinutes / 60
    val minutes = totalMinutes % 60
    return if (minutes == 0) "$hours h" else "$hours h $minutes"
  }
}
