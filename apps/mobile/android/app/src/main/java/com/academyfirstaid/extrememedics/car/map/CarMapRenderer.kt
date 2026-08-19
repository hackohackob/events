package com.academyfirstaid.extrememedics.car.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import androidx.car.app.CarContext
import androidx.car.app.SurfaceCallback
import androidx.car.app.SurfaceContainer
import com.academyfirstaid.extrememedics.car.CarDynamic
import com.academyfirstaid.extrememedics.car.CarMarker
import com.academyfirstaid.extrememedics.car.CarMarkerType
import com.academyfirstaid.extrememedics.car.CarPolyline
import com.academyfirstaid.extrememedics.car.CarStatic
import com.academyfirstaid.extrememedics.car.CarStore
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Draws the car map onto the head unit's surface.
 *
 * MapLibre cannot render here — the React Native wrapper has no way to attach
 * its renderer to an `androidx.car.app` surface — so this is a purpose-built
 * Canvas renderer over the same mapy.cz raster tiles the phone uses, with the
 * team's own vectors (tracks, zones, routes, markers) drawn on top.
 *
 * Threading: every frame is composed on a dedicated thread. Callbacks from the
 * car host arrive on the main thread and only ever mutate small volatile fields
 * before posting a redraw, so the main thread never blocks on drawing.
 */
class CarMapRenderer(private val carContext: CarContext) : SurfaceCallback {

  companion object {
    private const val TAG = "CarMapRenderer"

    private const val MIN_ZOOM = 3.0
    private const val MAX_ZOOM = 18.0
    /** Overview zoom when idle and following. */
    private const val DEFAULT_ZOOM = 14.0
    /** Tighter while navigating — the next turn is what matters. */
    private const val NAV_ZOOM = 16.0
    /** Pan/zoom by hand and following pauses until this long after the last touch. */
    private const val FOLLOW_RESUME_MS = 12_000L
    /** Frame ceiling. GPS lands at ~1 Hz; anything faster is battery for nothing. */
    private const val MIN_FRAME_INTERVAL_MS = 90L

    private const val COLOR_BACKDROP = 0xFF0B1420.toInt()
    private const val COLOR_TRACK = 0xFF38BDF8.toInt()
    private const val COLOR_ROUTE = 0xFF34D399.toInt()
    private const val COLOR_ROUTE_DONE = 0xFF475569.toInt()
    private const val COLOR_INCIDENT = 0xFFEF4444.toInt()
    private const val COLOR_ASSIGNED = 0xFFFBBF24.toInt()
    private const val COLOR_MEDIC = 0xFF34D399.toInt()
    private const val COLOR_MEDIC_REST = 0xFFA78BFA.toInt()
    private const val COLOR_POI = 0xFF60A5FA.toInt()
    private const val COLOR_ME = 0xFF22D3EE.toInt()
    private const val COLOR_TEXT = 0xFFE2E8F0.toInt()
    private const val COLOR_TEXT_DIM = 0xFF94A3B8.toInt()
  }

  // --------------------------------------------------------------- surface --

  private var surface: Surface? = null
  private var surfaceWidth = 0
  private var surfaceHeight = 0
  /** Area of the surface the host guarantees is unobstructed by its own chrome. */
  private var visibleArea = Rect()
  private var stableArea = Rect()

  private val renderThread = HandlerThread("car-map-render").apply { start() }
  private val renderHandler = Handler(renderThread.looper)
  private var frameScheduled = false
  private var lastFrameAt = 0L

  // ---------------------------------------------------------------- camera --

  @Volatile private var centerLat = 0.0
  @Volatile private var centerLng = 0.0
  @Volatile private var zoom = DEFAULT_ZOOM
  @Volatile private var haveCenter = false
  /** True when the camera tracks the medic; false after a manual pan/zoom. */
  @Volatile private var following = true
  @Volatile private var lastInteractionAt = 0L
  /** North-up, or rotated to the direction of travel. */
  @Volatile var headingUp = true
    private set

  private val tileCache = CarTileCache.get(carContext)

  // ----------------------------------------------------------------- paints --

  private val tilePaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
  private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = COLOR_TEXT
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
  }
  private val scratchPath = Path()

  private val storeListener: () -> Unit = { requestRender() }

  init {
    CarStore.addListener(storeListener)
    tileCache.onTileReady = { requestRender() }
  }

  /** Releases the render thread and all listeners. Called from Session teardown. */
  fun destroy() {
    CarStore.removeListener(storeListener)
    tileCache.onTileReady = null
    renderThread.quitSafely()
  }

  // ------------------------------------------------------- SurfaceCallback --

  override fun onSurfaceAvailable(container: SurfaceContainer) {
    surface = container.surface
    surfaceWidth = container.width
    surfaceHeight = container.height
    requestRender()
  }

  override fun onSurfaceDestroyed(container: SurfaceContainer) {
    surface = null
  }

  override fun onVisibleAreaChanged(area: Rect) {
    visibleArea = Rect(area)
    requestRender()
  }

  override fun onStableAreaChanged(area: Rect) {
    stableArea = Rect(area)
    requestRender()
  }

  override fun onScroll(distanceX: Float, distanceY: Float) {
    val zoomNow = zoom
    val world = MapGeometry.worldSize(zoomNow)
    // The gesture reports how far the CONTENT should move; dragging right pulls
    // the map with the finger, so the camera moves the opposite way.
    val x = MapGeometry.lngToWorldX(centerLng, zoomNow) + distanceX
    val y = MapGeometry.latToWorldY(centerLat, zoomNow) + distanceY
    centerLng = MapGeometry.worldXToLng(((x % world) + world) % world, zoomNow)
    centerLat = MapGeometry.worldYToLat(y.coerceIn(0.0, world), zoomNow)
    noteInteraction()
    requestRender()
  }

  override fun onScale(focusX: Float, focusY: Float, scaleFactor: Float) {
    if (scaleFactor <= 0f) return
    zoom = (zoom + Math.log(scaleFactor.toDouble()) / Math.log(2.0)).coerceIn(MIN_ZOOM, MAX_ZOOM)
    noteInteraction()
    requestRender()
  }

  override fun onFling(velocityX: Float, velocityY: Float) {
    // Deliberately not implemented: momentum panning on a map the rider glances
    // at is a way to lose your own position, not a feature.
  }

  override fun onClick(x: Float, y: Float) = Unit

  // ------------------------------------------------------------- camera API --

  /** Re-centres on the medic and resumes following. */
  fun recenter() {
    following = true
    lastInteractionAt = 0L
    requestRender()
  }

  fun toggleOrientation() {
    headingUp = !headingUp
    requestRender()
  }

  fun zoomBy(delta: Double) {
    zoom = (zoom + delta).coerceIn(MIN_ZOOM, MAX_ZOOM)
    noteInteraction()
    requestRender()
  }

  private fun noteInteraction() {
    following = false
    lastInteractionAt = android.os.SystemClock.elapsedRealtime()
  }

  // ----------------------------------------------------------------- frames --

  /** Coalesces redraw requests into at most one frame per interval. */
  fun requestRender() {
    synchronized(this) {
      if (frameScheduled) return
      frameScheduled = true
    }
    val since = android.os.SystemClock.elapsedRealtime() - lastFrameAt
    val delay = max(0L, MIN_FRAME_INTERVAL_MS - since)
    renderHandler.postDelayed({
      synchronized(this) { frameScheduled = false }
      lastFrameAt = android.os.SystemClock.elapsedRealtime()
      drawFrame()
    }, delay)
  }

  private fun drawFrame() {
    val target = surface ?: return
    if (!target.isValid) return
    val width = surfaceWidth
    val height = surfaceHeight
    if (width <= 0 || height <= 0) return

    val canvas = try {
      target.lockCanvas(null)
    } catch (error: Exception) {
      // The host can tear the surface down between the validity check and here.
      Log.w(TAG, "could not lock car surface", error)
      null
    } ?: return

    try {
      compose(canvas, width, height)
    } catch (error: Exception) {
      Log.e(TAG, "car frame failed", error)
    } finally {
      try {
        target.unlockCanvasAndPost(canvas)
      } catch (error: Exception) {
        Log.w(TAG, "could not post car frame", error)
      }
    }
  }

  // ------------------------------------------------------------------ draw --

  private fun compose(canvas: Canvas, width: Int, height: Int) {
    val dynamic = CarStore.dynamicData
    val staticData = CarStore.staticData
    canvas.drawColor(COLOR_BACKDROP)

    resolveCamera(dynamic)
    if (!haveCenter) {
      drawCentredMessage(canvas, width, height, "Waiting for a GPS fix…")
      return
    }

    // The medic sits low on the screen while navigating so the road ahead fills
    // it, and dead centre otherwise.
    val navigating = dynamic.nav.active
    val anchorX = width / 2f
    val anchorY = if (navigating) height * 0.68f else height / 2f

    val rotation = if (headingUp && navigating) -(dynamic.nav.bearing ?: 0.0).toFloat() else 0f
    val restore = canvas.save()
    if (rotation != 0f) canvas.rotate(rotation, anchorX, anchorY)

    val camera = Camera(centerLat, centerLng, zoom, anchorX, anchorY)
    // Rotation means the corners of the screen sample from outside the unrotated
    // viewport; padding by the half-diagonal covers every angle.
    val pad = if (rotation != 0f) (Math.hypot(width.toDouble(), height.toDouble()) / 2).toFloat() else 0f

    drawTiles(canvas, camera, width, height, pad, staticData.tileUrlTemplate)
    drawZones(canvas, camera, staticData.zones)
    drawPolylines(canvas, camera, staticData.tracks, COLOR_TRACK, 5f, 110)
    drawPolylines(canvas, camera, dynamic.medicRoutes, COLOR_MEDIC, 4f, 150)
    drawRoute(canvas, camera, dynamic)
    drawMarkers(canvas, camera, dynamic)
    drawMe(canvas, camera, dynamic)

    canvas.restoreToCount(restore)

    drawOverlay(canvas, width, height, dynamic)
  }

  /** Where the camera should sit this frame. */
  private fun resolveCamera(dynamic: CarDynamic) {
    val me = dynamic.me
    if (!following && lastInteractionAt > 0L &&
      android.os.SystemClock.elapsedRealtime() - lastInteractionAt > FOLLOW_RESUME_MS
    ) {
      following = true
    }
    if (me != null && (following || !haveCenter)) {
      centerLat = me.lat
      centerLng = me.lng
      haveCenter = true
      if (following) {
        val target = if (dynamic.nav.active) NAV_ZOOM else DEFAULT_ZOOM
        // Ease rather than snap, so resuming follow after a pan isn't a jolt.
        // Keep asking for frames until it settles — data pushes alone would
        // leave the easing half-finished whenever the medic is stationary.
        if (abs(zoom - target) > 0.02) {
          zoom += (target - zoom) * 0.25
          requestRender()
        } else {
          zoom = target
        }
      }
    } else if (me == null && !haveCenter) {
      // No fix yet: fall back to the event's own data so the car is not blank.
      val anchor = dynamic.markers.firstOrNull() ?: return
      centerLat = anchor.lat
      centerLng = anchor.lng
      haveCenter = true
    }
  }

  /** Screen projection for one frame. World pixels are resolved once per point. */
  private class Camera(
    val centerLat: Double,
    val centerLng: Double,
    val zoom: Double,
    val anchorX: Float,
    val anchorY: Float,
  ) {
    private val originX = MapGeometry.lngToWorldX(centerLng, zoom)
    private val originY = MapGeometry.latToWorldY(centerLat, zoom)

    fun screenX(lng: Double): Float = (MapGeometry.lngToWorldX(lng, zoom) - originX + anchorX).toFloat()
    fun screenY(lat: Double): Float = (MapGeometry.latToWorldY(lat, zoom) - originY + anchorY).toFloat()
    fun screenXFromWorld(worldX: Double): Float = (worldX - originX + anchorX).toFloat()
    fun screenYFromWorld(worldY: Double): Float = (worldY - originY + anchorY).toFloat()
  }

  private fun drawTiles(
    canvas: Canvas,
    camera: Camera,
    width: Int,
    height: Int,
    pad: Float,
    urlTemplate: String?,
  ) {
    if (urlTemplate == null) return
    val z = camera.zoom.roundToInt().coerceIn(MIN_ZOOM.toInt(), MAX_ZOOM.toInt())
    val scale = 1 shl z
    // Tiles are drawn at the size the fractional zoom implies, so zooming is
    // continuous rather than stepping between integer levels.
    val tileScreenSize = (MapGeometry.TILE_SIZE * Math.pow(2.0, camera.zoom - z)).toFloat()
    if (tileScreenSize <= 0f) return

    val leftWorld = MapGeometry.lngToWorldX(camera.centerLng, camera.zoom) - camera.anchorX - pad
    val topWorld = MapGeometry.latToWorldY(camera.centerLat, camera.zoom) - camera.anchorY - pad
    val tileWorldSize = MapGeometry.worldSize(camera.zoom) / scale

    val firstX = Math.floor(leftWorld / tileWorldSize).toInt()
    val firstY = Math.floor(topWorld / tileWorldSize).toInt()
    val columns = Math.ceil(((width + 2 * pad) / tileScreenSize).toDouble()).toInt() + 1
    val rows = Math.ceil(((height + 2 * pad) / tileScreenSize).toDouble()).toInt() + 1

    val destination = RectF()
    for (row in 0..rows) {
      val tileY = firstY + row
      if (tileY < 0 || tileY >= scale) continue
      for (column in 0..columns) {
        val tileX = firstX + column
        // Wrap the world horizontally so panning across the antimeridian works.
        val wrappedX = ((tileX % scale) + scale) % scale
        val bitmap: Bitmap = tileCache.bitmap(z, wrappedX, tileY, urlTemplate) ?: continue
        val left = camera.screenXFromWorld(tileX * tileWorldSize)
        val top = camera.screenYFromWorld(tileY * tileWorldSize)
        destination.set(left, top, left + tileScreenSize, top + tileScreenSize)
        canvas.drawBitmap(bitmap, null, destination, tilePaint)
      }
    }
  }

  private fun drawZones(canvas: Canvas, camera: Camera, zones: List<CarPolyline>) {
    for (zone in zones) {
      val path = buildPath(camera, zone.points, close = true) ?: continue
      val color = parseColor(zone.color, COLOR_POI)
      fillPaint.color = (color and 0x00FFFFFF) or (0x33 shl 24)
      canvas.drawPath(path, fillPaint)
      linePaint.color = color
      linePaint.strokeWidth = 3f
      linePaint.alpha = 200
      canvas.drawPath(path, linePaint)
    }
  }

  private fun drawPolylines(
    canvas: Canvas,
    camera: Camera,
    lines: List<CarPolyline>,
    fallbackColor: Int,
    strokeWidth: Float,
    alpha: Int,
  ) {
    for (line in lines) {
      val path = buildPath(camera, line.points, close = false) ?: continue
      linePaint.color = parseColor(line.color, fallbackColor)
      linePaint.strokeWidth = strokeWidth
      linePaint.alpha = alpha
      canvas.drawPath(path, linePaint)
    }
  }

  private fun drawRoute(canvas: Canvas, camera: Camera, dynamic: CarDynamic) {
    if (dynamic.nav.mode == "none") return
    buildPath(camera, dynamic.nav.travelledPoints, close = false)?.let { path ->
      linePaint.color = COLOR_ROUTE_DONE
      linePaint.strokeWidth = 8f
      linePaint.alpha = 200
      canvas.drawPath(path, linePaint)
    }
    buildPath(camera, dynamic.nav.routePoints, close = false)?.let { path ->
      // Casing first, then the line — the route has to read over any tile.
      linePaint.color = Color.BLACK
      linePaint.strokeWidth = 13f
      linePaint.alpha = 120
      canvas.drawPath(path, linePaint)
      linePaint.color = if (dynamic.nav.offRoute) COLOR_ASSIGNED else COLOR_ROUTE
      linePaint.strokeWidth = 9f
      linePaint.alpha = 255
      canvas.drawPath(path, linePaint)
    }
  }

  private fun drawMarkers(canvas: Canvas, camera: Camera, dynamic: CarDynamic) {
    textPaint.textSize = 22f
    for (marker in dynamic.markers) {
      // Runner dots are omitted entirely: hundreds of pins nobody can read at
      // speed, and they would bury the medics and incidents underneath them.
      if (marker.type == CarMarkerType.RUNNER || marker.isMe) continue
      val x = camera.screenX(marker.lng)
      val y = camera.screenY(marker.lat)
      if (x.isNaN() || y.isNaN()) continue
      if (x < -80 || y < -80 || x > surfaceWidth + 80 || y > surfaceHeight + 80) continue

      when (marker.type) {
        CarMarkerType.INCIDENT -> {
          if (!marker.isOpenIncident) continue
          val color = if (marker.assignedToMe) COLOR_ASSIGNED else COLOR_INCIDENT
          fillPaint.color = Color.BLACK
          fillPaint.alpha = 110
          canvas.drawCircle(x, y + 2f, 17f, fillPaint)
          fillPaint.color = color
          fillPaint.alpha = 255
          canvas.drawCircle(x, y, 15f, fillPaint)
          fillPaint.color = Color.WHITE
          canvas.drawCircle(x, y, 5f, fillPaint)
        }
        CarMarkerType.PARAMEDIC -> {
          val color = when (marker.status) {
            "rest" -> COLOR_MEDIC_REST
            "going_to" -> COLOR_ASSIGNED
            else -> COLOR_MEDIC
          }
          fillPaint.color = Color.BLACK
          fillPaint.alpha = 110
          canvas.drawCircle(x, y + 2f, 14f, fillPaint)
          fillPaint.color = color
          fillPaint.alpha = if (marker.staleState == "stale" || marker.staleState == "offline") 120 else 255
          canvas.drawCircle(x, y, 12f, fillPaint)
        }
        CarMarkerType.POI -> {
          fillPaint.color = COLOR_POI
          fillPaint.alpha = 235
          canvas.drawRect(x - 8f, y - 8f, x + 8f, y + 8f, fillPaint)
        }
        CarMarkerType.RUNNER -> Unit
      }
    }
  }

  /** The medic's own position: a heading arrow, or a dot when standing still. */
  private fun drawMe(canvas: Canvas, camera: Camera, dynamic: CarDynamic) {
    val me = dynamic.me ?: return
    val x = camera.screenX(me.lng)
    val y = camera.screenY(me.lat)

    // Accuracy halo, in real ground units.
    me.accuracyMeters?.let { accuracy ->
      val radius = (accuracy / MapGeometry.metersPerPixel(me.lat, camera.zoom)).toFloat()
      if (radius > 12f && radius < 400f) {
        fillPaint.color = COLOR_ME
        fillPaint.alpha = 40
        canvas.drawCircle(x, y, radius, fillPaint)
      }
    }

    val bearing = dynamic.nav.bearing
    // The canvas may already be rotated by -bearing (heading-up), in which case
    // rotating the arrow by +bearing leaves it pointing up the screen; north-up
    // has no outer rotation, so the same call aims it along the true bearing.
    val restore = canvas.save()
    if (bearing != null) canvas.rotate(bearing.toFloat(), x, y)

    fillPaint.color = Color.BLACK
    fillPaint.alpha = 120
    canvas.drawCircle(x, y + 2f, 17f, fillPaint)
    fillPaint.color = COLOR_ME
    fillPaint.alpha = 255

    if (bearing != null) {
      scratchPath.reset()
      scratchPath.moveTo(x, y - 18f)
      scratchPath.lineTo(x + 12f, y + 14f)
      scratchPath.lineTo(x, y + 7f)
      scratchPath.lineTo(x - 12f, y + 14f)
      scratchPath.close()
      canvas.drawPath(scratchPath, fillPaint)
    } else {
      canvas.drawCircle(x, y, 13f, fillPaint)
      fillPaint.color = Color.WHITE
      canvas.drawCircle(x, y, 5f, fillPaint)
    }
    canvas.restoreToCount(restore)
  }

  /**
   * Screen-fixed furniture: scale bar, north indicator, and the "not following"
   * hint. Drawn outside the rotation so it stays upright.
   */
  private fun drawOverlay(canvas: Canvas, width: Int, height: Int, dynamic: CarDynamic) {
    val inset = if (visibleArea.isEmpty) 16 else max(16, visibleArea.left + 12)
    val bottom = if (visibleArea.isEmpty) height - 20f else visibleArea.bottom - 20f

    // Scale bar: pick the roundest distance that fits ~120 px.
    val metersPerPixel = MapGeometry.metersPerPixel(centerLat, zoom)
    val targetMeters = metersPerPixel * 120
    val niceMeters = niceRoundDistance(targetMeters)
    val barPixels = (niceMeters / metersPerPixel).toFloat()
    if (barPixels in 20f..400f) {
      linePaint.color = Color.BLACK
      linePaint.alpha = 140
      linePaint.strokeWidth = 6f
      canvas.drawLine(inset.toFloat(), bottom, inset + barPixels, bottom, linePaint)
      linePaint.color = COLOR_TEXT
      linePaint.alpha = 255
      linePaint.strokeWidth = 2.5f
      canvas.drawLine(inset.toFloat(), bottom, inset + barPixels, bottom, linePaint)
      textPaint.textSize = 20f
      textPaint.color = COLOR_TEXT
      canvas.drawText(MapGeometry.formatDistance(niceMeters), inset.toFloat(), bottom - 10f, textPaint)
    }

    if (!following) {
      textPaint.textSize = 22f
      textPaint.color = COLOR_TEXT_DIM
      canvas.drawText("Map moved — tap Recenter", inset.toFloat(), bottom - 44f, textPaint)
    }

    // A snapshot restored from disk is history, and must say so.
    if (!CarStore.live && dynamic.me == null) {
      textPaint.textSize = 22f
      textPaint.color = COLOR_ASSIGNED
      canvas.drawText("Last known positions — reconnecting…", inset.toFloat(), bottom - 76f, textPaint)
    }
  }

  private fun drawCentredMessage(canvas: Canvas, width: Int, height: Int, message: String) {
    textPaint.textSize = 30f
    textPaint.color = COLOR_TEXT_DIM
    val textWidth = textPaint.measureText(message)
    canvas.drawText(message, (width - textWidth) / 2f, height / 2f, textPaint)
  }

  // ------------------------------------------------------------- utilities --

  /** Builds a screen-space path, skipping points that project off-canvas far
   *  enough to matter. Returns null when nothing would be visible. */
  private fun buildPath(camera: Camera, points: DoubleArray, close: Boolean): Path? {
    if (points.size < 4) return null
    val path = Path()
    var started = false
    var anyVisible = false
    val margin = 400f
    var i = 0
    while (i + 1 < points.size) {
      val x = camera.screenX(points[i])
      val y = camera.screenY(points[i + 1])
      i += 2
      if (x.isNaN() || y.isNaN()) continue
      if (x > -margin && y > -margin && x < surfaceWidth + margin && y < surfaceHeight + margin) anyVisible = true
      if (!started) {
        path.moveTo(x, y)
        started = true
      } else {
        path.lineTo(x, y)
      }
    }
    if (!started || !anyVisible) return null
    if (close) path.close()
    return path
  }

  private fun parseColor(raw: String?, fallback: Int): Int {
    if (raw.isNullOrEmpty()) return fallback
    return try {
      Color.parseColor(raw)
    } catch (error: IllegalArgumentException) {
      fallback
    }
  }

  /** 1/2/5 × 10ⁿ, so the scale bar always reads as a round number. */
  private fun niceRoundDistance(meters: Double): Double {
    if (meters <= 0) return 100.0
    val magnitude = Math.pow(10.0, Math.floor(Math.log10(meters)))
    val normalized = meters / magnitude
    val stepped = when {
      normalized < 1.5 -> 1.0
      normalized < 3.5 -> 2.0
      normalized < 7.5 -> 5.0
      else -> 10.0
    }
    return stepped * magnitude
  }
}
