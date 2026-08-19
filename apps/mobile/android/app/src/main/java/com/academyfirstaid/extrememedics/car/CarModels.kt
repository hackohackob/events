package com.academyfirstaid.extrememedics.car

import org.json.JSONArray
import org.json.JSONObject

/**
 * Native mirror of `apps/mobile/src/car/car-types.ts`.
 *
 * Parsing is total: every field falls back to a sane default rather than
 * throwing, because a payload this side cannot understand must degrade the car
 * screen, never crash it while someone is riding.
 */
const val CAR_PROTOCOL_VERSION = 1

/** Flat `[lng, lat, lng, lat, …]`, kept primitive — the renderer walks these
 *  arrays on every frame and boxing them would show up as jank. */
typealias FlatCoords = DoubleArray

private fun JSONObject.optStringOrNull(name: String): String? {
  if (!has(name) || isNull(name)) return null
  val value = optString(name, "")
  return value.ifEmpty { null }
}

private fun JSONObject.optDoubleOrNull(name: String): Double? {
  if (!has(name) || isNull(name)) return null
  val value = optDouble(name, Double.NaN)
  return if (value.isNaN()) null else value
}

private fun JSONObject.optLongOrNull(name: String): Long? = optDoubleOrNull(name)?.toLong()

private fun JSONObject.optIntOrNull(name: String): Int? = optDoubleOrNull(name)?.toInt()

private fun JSONArray?.toFlatCoords(): FlatCoords {
  if (this == null) return DoubleArray(0)
  // An odd-length array would desynchronise every lng/lat pair after it; drop
  // the stray tail rather than drawing a garbage line.
  val usable = length() - (length() % 2)
  val out = DoubleArray(usable)
  for (i in 0 until usable) out[i] = optDouble(i, 0.0)
  return out
}

// ------------------------------------------------------------------ static ---

data class CarPolyline(
  val id: String,
  val label: String,
  val color: String?,
  val points: FlatCoords,
)

data class CarBuildInfo(
  val appVersion: String,
  val nativeBuild: String,
  val runtimeVersion: String,
  val updateId: String?,
  val channel: String?,
  val updateAppliedAt: Long?,
  val firstLaunchAt: Long?,
) {
  companion object {
    val EMPTY = CarBuildInfo("—", "—", "—", null, null, null, null)

    fun from(json: JSONObject?): CarBuildInfo {
      if (json == null) return EMPTY
      return CarBuildInfo(
        appVersion = json.optString("appVersion", "—"),
        nativeBuild = json.optString("nativeBuild", "—"),
        runtimeVersion = json.optString("runtimeVersion", "—"),
        updateId = json.optStringOrNull("updateId"),
        channel = json.optStringOrNull("channel"),
        updateAppliedAt = json.optLongOrNull("updateAppliedAt"),
        firstLaunchAt = json.optLongOrNull("firstLaunchAt"),
      )
    }
  }
}

data class CarStatic(
  val tileUrlTemplate: String?,
  val tracks: List<CarPolyline>,
  val zones: List<CarPolyline>,
  val build: CarBuildInfo,
) {
  companion object {
    val EMPTY = CarStatic(null, emptyList(), emptyList(), CarBuildInfo.EMPTY)

    fun parse(json: JSONObject): CarStatic? {
      if (json.optInt("v", -1) != CAR_PROTOCOL_VERSION) return null
      return CarStatic(
        tileUrlTemplate = json.optStringOrNull("tileUrlTemplate"),
        tracks = parsePolylines(json.optJSONArray("tracks")),
        zones = parsePolylines(json.optJSONArray("zones")),
        build = CarBuildInfo.from(json.optJSONObject("build")),
      )
    }
  }
}

/** Shared by tracks, zones and medic routes — all three are the same wire shape. */
private fun parsePolylines(array: JSONArray?): List<CarPolyline> {
  if (array == null) return emptyList()
  val out = ArrayList<CarPolyline>(array.length())
  for (i in 0 until array.length()) {
    val item = array.optJSONObject(i) ?: continue
    val points = item.optJSONArray("points").toFlatCoords()
    // A "line" of one point cannot be drawn and is never worth keeping.
    if (points.size < 4) continue
    out.add(
      CarPolyline(
        id = item.optString("id", "line-$i"),
        label = item.optString("label", ""),
        color = item.optStringOrNull("color"),
        points = points,
      ),
    )
  }
  return out
}

// ----------------------------------------------------------------- dynamic ---

enum class CarMarkerType { PARAMEDIC, INCIDENT, POI, RUNNER;
  companion object {
    fun from(raw: String?): CarMarkerType = when (raw) {
      "paramedic" -> PARAMEDIC
      "incident" -> INCIDENT
      "infrastructure" -> POI
      else -> RUNNER
    }
  }
}

data class CarMarker(
  val id: String,
  val type: CarMarkerType,
  val label: String,
  val lat: Double,
  val lng: Double,
  val status: String?,
  val vehicleType: String?,
  val poiType: String?,
  val incidentType: String?,
  val incidentStatus: String?,
  val staleState: String?,
  val assignedToMe: Boolean,
  val isMe: Boolean,
  val distanceMeters: Int?,
) {
  /** Closed incidents stay on the map but must never be offered as a job. */
  val isOpenIncident: Boolean
    get() = type == CarMarkerType.INCIDENT &&
      incidentStatus != "resolved" && incidentStatus != "closed" && incidentStatus != "archived"
}

data class CarPosition(val lat: Double, val lng: Double, val accuracyMeters: Double?, val at: Long)

data class CarNav(
  val mode: String,
  val active: Boolean,
  val destinationLabel: String?,
  val routePoints: FlatCoords,
  val travelledPoints: FlatCoords,
  val remainingMeters: Double?,
  val remainingMs: Long?,
  val toManeuverMeters: Double?,
  val maneuver: String?,
  val cue: String?,
  val road: String?,
  val offRoute: Boolean,
  val bearing: Double?,
  val speedMps: Double?,
  val voiceMuted: Boolean,
) {
  companion object {
    val IDLE = CarNav(
      "none", false, null, DoubleArray(0), DoubleArray(0),
      null, null, null, null, null, null, false, null, null, false,
    )

    fun from(json: JSONObject?): CarNav {
      if (json == null) return IDLE
      return CarNav(
        mode = json.optString("mode", "none"),
        active = json.optBoolean("active", false),
        destinationLabel = json.optStringOrNull("destinationLabel"),
        routePoints = json.optJSONArray("routePoints").toFlatCoords(),
        travelledPoints = json.optJSONArray("travelledPoints").toFlatCoords(),
        remainingMeters = json.optDoubleOrNull("remainingMeters"),
        remainingMs = json.optLongOrNull("remainingMs"),
        toManeuverMeters = json.optDoubleOrNull("toManeuverMeters"),
        maneuver = json.optStringOrNull("maneuver"),
        cue = json.optStringOrNull("cue"),
        road = json.optStringOrNull("road"),
        offRoute = json.optBoolean("offRoute", false),
        bearing = json.optDoubleOrNull("bearing"),
        speedMps = json.optDoubleOrNull("speedMps"),
        voiceMuted = json.optBoolean("voiceMuted", false),
      )
    }
  }
}

data class CarDiagnostics(
  val fixAgeMs: Long?,
  val accuracyMeters: Double?,
  val batteryPercent: Double?,
  val lastReportOk: Boolean?,
  val lastReportVia: String?,
  val lastReportAgeMs: Long?,
  val socketConnected: Boolean,
  val online: Boolean,
  val queuedLocations: Int,
  val queuedIncidents: Int,
  val effectiveIntervalMs: Long,
  val trackingIssues: List<String>,
  val batteryOptimizationIgnored: Boolean?,
  val drainPercentPerHour: Double?,
) {
  companion object {
    val EMPTY = CarDiagnostics(
      null, null, null, null, null, null, false, false, 0, 0, 0, emptyList(), null, null,
    )

    fun from(json: JSONObject?): CarDiagnostics {
      if (json == null) return EMPTY
      val issuesArray = json.optJSONArray("trackingIssues")
      val issues = ArrayList<String>(issuesArray?.length() ?: 0)
      if (issuesArray != null) for (i in 0 until issuesArray.length()) issues.add(issuesArray.optString(i, ""))
      return CarDiagnostics(
        fixAgeMs = json.optLongOrNull("fixAgeMs"),
        accuracyMeters = json.optDoubleOrNull("accuracyMeters"),
        batteryPercent = json.optDoubleOrNull("batteryPercent"),
        lastReportOk = if (json.isNull("lastReportOk")) null else json.optBoolean("lastReportOk"),
        lastReportVia = json.optStringOrNull("lastReportVia"),
        lastReportAgeMs = json.optLongOrNull("lastReportAgeMs"),
        socketConnected = json.optBoolean("socketConnected", false),
        online = json.optBoolean("online", false),
        queuedLocations = json.optInt("queuedLocations", 0),
        queuedIncidents = json.optInt("queuedIncidents", 0),
        effectiveIntervalMs = json.optLong("effectiveIntervalMs", 0L),
        trackingIssues = issues.filter { it.isNotEmpty() },
        batteryOptimizationIgnored =
          if (json.isNull("batteryOptimizationIgnored")) null else json.optBoolean("batteryOptimizationIgnored"),
        drainPercentPerHour = json.optDoubleOrNull("drainPercentPerHour"),
      )
    }
  }
}

data class CarSettings(
  val locationIntervalMs: Long,
  val trackOffsetEnabled: Boolean,
  val trackGradientEnabled: Boolean,
  val kmMarkersEnabled: Boolean,
  val kmMarkerIntervalKm: Int,
  val showArchived: Boolean,
  val androidAutoEnabled: Boolean,
  val voiceMuted: Boolean,
) {
  companion object {
    val DEFAULTS = CarSettings(180_000L, false, true, true, 5, false, true, false)

    fun from(json: JSONObject?): CarSettings {
      if (json == null) return DEFAULTS
      return CarSettings(
        locationIntervalMs = json.optLong("locationIntervalMs", DEFAULTS.locationIntervalMs),
        trackOffsetEnabled = json.optBoolean("trackOffsetEnabled", DEFAULTS.trackOffsetEnabled),
        trackGradientEnabled = json.optBoolean("trackGradientEnabled", DEFAULTS.trackGradientEnabled),
        kmMarkersEnabled = json.optBoolean("kmMarkersEnabled", DEFAULTS.kmMarkersEnabled),
        kmMarkerIntervalKm = json.optInt("kmMarkerIntervalKm", DEFAULTS.kmMarkerIntervalKm),
        showArchived = json.optBoolean("showArchived", DEFAULTS.showArchived),
        androidAutoEnabled = json.optBoolean("androidAutoEnabled", DEFAULTS.androidAutoEnabled),
        voiceMuted = json.optBoolean("voiceMuted", DEFAULTS.voiceMuted),
      )
    }
  }
}

data class CarDynamic(
  val signedIn: Boolean,
  val hydrated: Boolean,
  val eventTitle: String?,
  val userId: String?,
  val role: String,
  val isMedic: Boolean,
  val me: CarPosition?,
  val myStatus: String,
  val markers: List<CarMarker>,
  val medicRoutes: List<CarPolyline>,
  val assignedIncidentId: String?,
  val nav: CarNav,
  val settings: CarSettings,
  val diagnostics: CarDiagnostics,
  val recording: Boolean,
  val toast: String?,
) {
  /** Open incidents, nearest first — the order the car list is built in. */
  val openIncidents: List<CarMarker>
    get() = markers.filter { it.isOpenIncident }.sortedBy { it.distanceMeters ?: Int.MAX_VALUE }

  val assignedIncident: CarMarker?
    get() = assignedIncidentId?.let { id -> markers.firstOrNull { it.id == id } }

  companion object {
    val EMPTY = CarDynamic(
      signedIn = false,
      hydrated = false,
      eventTitle = null,
      userId = null,
      role = "runner",
      isMedic = false,
      me = null,
      myStatus = "available",
      markers = emptyList(),
      medicRoutes = emptyList(),
      assignedIncidentId = null,
      nav = CarNav.IDLE,
      settings = CarSettings.DEFAULTS,
      diagnostics = CarDiagnostics.EMPTY,
      recording = false,
      toast = null,
    )

    fun parse(json: JSONObject): CarDynamic? {
      if (json.optInt("v", -1) != CAR_PROTOCOL_VERSION) return null
      val meJson = json.optJSONObject("me")
      return CarDynamic(
        signedIn = json.optBoolean("signedIn", false),
        hydrated = json.optBoolean("hydrated", false),
        eventTitle = json.optStringOrNull("eventTitle"),
        userId = json.optStringOrNull("userId"),
        role = json.optString("role", "runner"),
        isMedic = json.optBoolean("isMedic", false),
        me = meJson?.let {
          CarPosition(
            lat = it.optDouble("lat", 0.0),
            lng = it.optDouble("lng", 0.0),
            accuracyMeters = it.optDoubleOrNull("accuracyMeters"),
            at = it.optLong("at", 0L),
          )
        },
        myStatus = json.optString("myStatus", "available"),
        markers = parseMarkers(json.optJSONArray("markers")),
        medicRoutes = parsePolylines(json.optJSONArray("medicRoutes")),
        assignedIncidentId = json.optStringOrNull("assignedIncidentId"),
        nav = CarNav.from(json.optJSONObject("nav")),
        settings = CarSettings.from(json.optJSONObject("settings")),
        diagnostics = CarDiagnostics.from(json.optJSONObject("diagnostics")),
        recording = json.optBoolean("recording", false),
        toast = json.optStringOrNull("toast"),
      )
    }

    private fun parseMarkers(array: JSONArray?): List<CarMarker> {
      if (array == null) return emptyList()
      val out = ArrayList<CarMarker>(array.length())
      for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val lat = item.optDoubleOrNull("lat") ?: continue
        val lng = item.optDoubleOrNull("lng") ?: continue
        out.add(
          CarMarker(
            id = item.optString("id", "marker-$i"),
            type = CarMarkerType.from(item.optStringOrNull("type")),
            label = item.optString("label", "—"),
            lat = lat,
            lng = lng,
            status = item.optStringOrNull("status"),
            vehicleType = item.optStringOrNull("vehicleType"),
            poiType = item.optStringOrNull("poiType"),
            incidentType = item.optStringOrNull("incidentType"),
            incidentStatus = item.optStringOrNull("incidentStatus"),
            staleState = item.optStringOrNull("staleState"),
            assignedToMe = item.optBoolean("assignedToMe", false),
            isMe = item.optBoolean("isMe", false),
            distanceMeters = item.optIntOrNull("distanceMeters"),
          ),
        )
      }
      return out
    }
  }
}
