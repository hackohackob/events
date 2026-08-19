package com.academyfirstaid.extrememedics.car.map

import androidx.car.app.model.DateTimeWithZone
import androidx.car.app.model.Distance
import androidx.car.app.navigation.model.Maneuver
import androidx.car.app.navigation.model.Step
import com.academyfirstaid.extrememedics.car.CarNav
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Translates the app's routing vocabulary into the car library's.
 *
 * The maneuver names come from `apps/mobile/src/navigation/types.ts`
 * (`ManeuverKind`), which is itself the mobile mirror of the backend's
 * GraphHopper contract — so this is the single place where a routing engine
 * term becomes an Android Auto icon.
 */
object CarManeuvers {

  /** Below this a distance reads better in metres than in fractional km. */
  private const val METERS_TO_KM_THRESHOLD = 950.0

  fun step(nav: CarNav): Step? {
    val cue = nav.cue ?: return null
    val builder = Step.Builder(cue)
    maneuver(nav.maneuver)?.let { builder.setManeuver(it) }
    nav.road?.takeIf { it.isNotBlank() }?.let { builder.setRoad(it) }
    return builder.build()
  }

  private fun maneuver(kind: String?): Maneuver? {
    val type = when (kind) {
      "depart" -> Maneuver.TYPE_DEPART
      "arrive" -> Maneuver.TYPE_DESTINATION
      "continue" -> Maneuver.TYPE_STRAIGHT
      "turn-slight-left" -> Maneuver.TYPE_TURN_SLIGHT_LEFT
      "turn-left" -> Maneuver.TYPE_TURN_NORMAL_LEFT
      "turn-sharp-left" -> Maneuver.TYPE_TURN_SHARP_LEFT
      "turn-slight-right" -> Maneuver.TYPE_TURN_SLIGHT_RIGHT
      "turn-right" -> Maneuver.TYPE_TURN_NORMAL_RIGHT
      "turn-sharp-right" -> Maneuver.TYPE_TURN_SHARP_RIGHT
      "uturn" -> Maneuver.TYPE_U_TURN_LEFT
      "keep-left" -> Maneuver.TYPE_KEEP_LEFT
      "keep-right" -> Maneuver.TYPE_KEEP_RIGHT
      // The "…_AND_EXIT_…" variants REQUIRE an exit number, which the engine
      // does not always give us, so the plain enter type is the only one that
      // is always safe to build. CCW because Bulgaria drives on the right.
      "roundabout" -> Maneuver.TYPE_ROUNDABOUT_ENTER_CCW
      "via" -> Maneuver.TYPE_STRAIGHT
      else -> return null
    }
    return try {
      Maneuver.Builder(type).build()
    } catch (error: IllegalArgumentException) {
      // A maneuver the host cannot build must not cost us the whole banner.
      null
    }
  }

  /** Metres → a `Distance` in the unit a rider actually reads at that range. */
  fun distance(meters: Double?): Distance? {
    if (meters == null || meters.isNaN() || meters < 0) return null
    return if (meters < METERS_TO_KM_THRESHOLD) {
      Distance.create(meters, Distance.UNIT_METERS)
    } else {
      Distance.create(meters / 1000.0, Distance.UNIT_KILOMETERS)
    }
  }

  /**
   * Arrival time for a `TravelEstimate`. The builder demands one even when the
   * engine gave no duration (track-following), in which case "now" is the only
   * honest answer and the host renders the estimate without a countdown.
   */
  fun arrivalTime(remainingMs: Long?): DateTimeWithZone {
    val zone = TimeZone.getDefault()
    val at = System.currentTimeMillis() + (remainingMs ?: 0L)
    return DateTimeWithZone.create(at, zone)
  }

  /** Seconds form used by the trip/cluster payload. */
  fun remainingSeconds(remainingMs: Long?): Long =
    TimeUnit.MILLISECONDS.toSeconds(remainingMs ?: 0L)
}
