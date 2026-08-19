package com.academyfirstaid.extrememedics.car.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.util.LruCache
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Raster tile store for the car map.
 *
 * MapLibre's offline packs are held in MapLibre's own private database, which
 * this renderer cannot read, so the car keeps its own cache: a bitmap LRU in
 * memory over a size-capped directory on disk. Fetching is plain
 * HttpURLConnection — no HTTP client dependency to keep in step with anything.
 *
 * Two ways in:
 *  - {@link bitmap} — what the renderer calls; returns immediately from memory
 *    or disk, and schedules a network fetch otherwise (newest request first, so
 *    a fast pan doesn't spend the whole budget on tiles already off screen).
 *  - {@link prefetch} — the phone's "Download for car" button.
 */
class CarTileCache private constructor(context: Context) {

  companion object {
    private const val TAG = "CarTileCache"
    /** Roughly a large event area at zoom 10–15. Oldest tiles evicted first. */
    private const val DISK_BUDGET_BYTES = 512L * 1024 * 1024
    private const val MEMORY_BUDGET_BYTES = 32 * 1024 * 1024
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 12_000
    /** The public tile APIs refuse (or throttle) a request with no user agent. */
    private const val USER_AGENT = "ExtremeMedics-AndroidAuto"
    private const val FETCH_THREADS = 4
    /** Ceiling on queued viewport fetches; the tail is the oldest viewport. */
    private const val MAX_PENDING_REQUESTS = 96
    private const val PREFETCH_THREADS = 3
    /** Don't retry a 404/403 on every frame — remember the misses for a while. */
    private const val FAILURE_TTL_MS = 60_000L

    @Volatile
    private var instance: CarTileCache? = null

    fun get(context: Context): CarTileCache =
      instance ?: synchronized(this) {
        instance ?: CarTileCache(context.applicationContext).also { instance = it }
      }
  }

  private val root = File(context.filesDir, "car-tiles").apply { mkdirs() }

  private val memory = object : LruCache<String, Bitmap>(MEMORY_BUDGET_BYTES) {
    override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
  }

  /** Tiles currently being fetched, so a redraw doesn't queue the same one twice. */
  private val inFlight = ConcurrentHashMap.newKeySet<String>()
  private val failures = ConcurrentHashMap<String, Long>()

  /**
   * Pending viewport fetches, newest first: after a pan, the tile just asked
   * for matters and the backlog behind it mostly does not. A plain executor
   * queue is FIFO, so the workers below take from this deque themselves.
   */
  private val pending = LinkedBlockingDeque<TileRequest>()

  private data class TileRequest(val key: String, val z: Int, val x: Int, val y: Int, val urlTemplate: String)

  private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "car-tile-io").apply { isDaemon = true }
  }

  private val prefetchExecutor = ThreadPoolExecutor(
    PREFETCH_THREADS, PREFETCH_THREADS, 30L, TimeUnit.SECONDS, LinkedBlockingDeque(),
  ) { runnable -> Thread(runnable, "car-tile-prefetch").apply { isDaemon = true } }

  private val prefetchCancelled = AtomicBoolean(false)

  /** Invoked (on a background thread) whenever a tile becomes available. */
  @Volatile
  var onTileReady: (() -> Unit)? = null

  init {
    repeat(FETCH_THREADS) { index ->
      Thread({
        while (true) {
          // takeFirst blocks until there is work — these threads idle at zero
          // cost when the car is not connected.
          val request = try {
            pending.takeFirst()
          } catch (interrupted: InterruptedException) {
            return@Thread
          }
          serve(request)
        }
      }, "car-tile-fetch-$index").apply { isDaemon = true }.start()
    }
    ioExecutor.execute { enforceDiskBudget() }
  }

  // ----------------------------------------------------------------- read ---

  /**
   * The tile if it is already in memory, otherwise null — with a fetch (disk,
   * then network) scheduled. Never blocks: this is called from the render loop.
   */
  fun bitmap(z: Int, x: Int, y: Int, urlTemplate: String): Bitmap? {
    val key = key(z, x, y)
    memory.get(key)?.let { return it }
    schedule(key, z, x, y, urlTemplate)
    return null
  }

  private fun schedule(key: String, z: Int, x: Int, y: Int, urlTemplate: String) {
    failures[key]?.let { failedAt ->
      if (System.currentTimeMillis() - failedAt < FAILURE_TTL_MS) return
      failures.remove(key)
    }
    if (!inFlight.add(key)) return
    pending.addFirst(TileRequest(key, z, x, y, urlTemplate))
    // Anything this far down the deque is off screen by now; dropping it keeps
    // a long pan from queueing thousands of tiles nobody will look at.
    while (pending.size > MAX_PENDING_REQUESTS) {
      pending.pollLast()?.let { inFlight.remove(it.key) }
    }
  }

  private fun serve(request: TileRequest) {
    try {
      val file = tileFile(request.z, request.x, request.y)
      var bytes = if (file.exists()) file.readBytes() else null
      if (bytes == null) {
        bytes = download(request.urlTemplate, request.z, request.x, request.y)
        if (bytes != null) writeTile(file, bytes)
      }
      val bitmap = bytes?.let { decode(it) }
      if (bitmap != null) {
        memory.put(request.key, bitmap)
        onTileReady?.invoke()
      } else {
        failures[request.key] = System.currentTimeMillis()
      }
    } catch (error: Exception) {
      failures[request.key] = System.currentTimeMillis()
      Log.w(TAG, "tile fetch failed ${request.z}/${request.x}/${request.y}", error)
    } finally {
      inFlight.remove(request.key)
    }
  }

  // ------------------------------------------------------------- prefetch ---

  /**
   * Downloads every tile covering `bounds` across the zoom span. Returns how
   * many tiles the job covers; progress is reported through `onProgress`.
   */
  fun prefetch(
    minLat: Double,
    minLng: Double,
    maxLat: Double,
    maxLng: Double,
    minZoom: Int,
    maxZoom: Int,
    urlTemplate: String,
    onProgress: (done: Int, total: Int, bytes: Long, finished: Boolean, error: String?) -> Unit,
  ): Int {
    cancelPrefetch()
    prefetchCancelled.set(false)

    data class Tile(val z: Int, val x: Int, val y: Int)
    val tiles = ArrayList<Tile>()
    for (z in minZoom..maxZoom) {
      val scale = 1 shl z
      val xMin = MapGeometry.tileX(minLng, z).coerceIn(0, scale - 1)
      val xMax = MapGeometry.tileX(maxLng, z).coerceIn(0, scale - 1)
      val yMin = MapGeometry.tileY(maxLat, z).coerceIn(0, scale - 1)
      val yMax = MapGeometry.tileY(minLat, z).coerceIn(0, scale - 1)
      for (x in minOf(xMin, xMax)..maxOf(xMin, xMax)) {
        for (y in minOf(yMin, yMax)..maxOf(yMin, yMax)) tiles.add(Tile(z, x, y))
      }
    }

    val total = tiles.size
    if (total == 0) {
      onProgress(0, 0, 0L, true, null)
      return 0
    }

    val done = AtomicInteger(0)
    val bytes = AtomicLong(0)
    val remaining = AtomicInteger(total)

    for (tile in tiles) {
      prefetchExecutor.execute {
        if (prefetchCancelled.get()) {
          if (remaining.decrementAndGet() == 0) onProgress(done.get(), total, bytes.get(), true, null)
          return@execute
        }
        try {
          val file = tileFile(tile.z, tile.x, tile.y)
          if (!file.exists()) {
            val data = download(urlTemplate, tile.z, tile.x, tile.y)
            if (data != null) {
              writeTile(file, data)
              bytes.addAndGet(data.size.toLong())
            }
          } else {
            bytes.addAndGet(file.length())
          }
        } catch (error: Exception) {
          Log.w(TAG, "prefetch tile failed", error)
        } finally {
          val completed = done.incrementAndGet()
          // One update per 25 tiles keeps the bridge quiet on a 5,000 tile job.
          if (completed % 25 == 0) onProgress(completed, total, bytes.get(), false, null)
          if (remaining.decrementAndGet() == 0) {
            ioExecutor.execute { enforceDiskBudget() }
            onProgress(completed, total, bytes.get(), true, null)
          }
        }
      }
    }
    return total
  }

  fun cancelPrefetch() {
    prefetchCancelled.set(true)
    prefetchExecutor.queue.clear()
  }

  // ------------------------------------------------------------ management --

  fun stats(callback: (tiles: Int, bytes: Long) -> Unit) {
    ioExecutor.execute {
      var count = 0
      var bytes = 0L
      root.walkTopDown().forEach { file ->
        if (file.isFile) {
          count += 1
          bytes += file.length()
        }
      }
      callback(count, bytes)
    }
  }

  fun clear(callback: () -> Unit) {
    ioExecutor.execute {
      memory.evictAll()
      failures.clear()
      root.deleteRecursively()
      root.mkdirs()
      callback()
    }
  }

  /** Trims the oldest tiles until the directory fits the budget. */
  private fun enforceDiskBudget() {
    try {
      val files = root.walkTopDown().filter { it.isFile }.toMutableList()
      var total = files.sumOf { it.length() }
      if (total <= DISK_BUDGET_BYTES) return
      files.sortBy { it.lastModified() }
      for (file in files) {
        if (total <= DISK_BUDGET_BYTES) break
        val size = file.length()
        if (file.delete()) total -= size
      }
    } catch (error: Exception) {
      Log.w(TAG, "tile cache trim failed", error)
    }
  }

  // ------------------------------------------------------------------ io ----

  private fun key(z: Int, x: Int, y: Int) = "$z/$x/$y"

  private fun tileFile(z: Int, x: Int, y: Int) = File(root, "$z/$x/$y.tile")

  private fun writeTile(file: File, bytes: ByteArray) {
    file.parentFile?.mkdirs()
    // Write-then-rename: a fetch interrupted mid-write must not leave a
    // truncated file that decodes to a grey square forever after.
    val temp = File(file.parentFile, "${file.name}.part")
    temp.writeBytes(bytes)
    if (!temp.renameTo(file)) {
      temp.delete()
    }
  }

  private fun decode(bytes: ByteArray): Bitmap? = try {
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
  } catch (error: Exception) {
    null
  }

  private fun download(urlTemplate: String, z: Int, x: Int, y: Int): ByteArray? {
    val url = urlTemplate
      .replace("{z}", z.toString())
      .replace("{x}", x.toString())
      .replace("{y}", y.toString())
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        setRequestProperty("User-Agent", USER_AGENT)
        requestMethod = "GET"
      }
      if (connection.responseCode !in 200..299) return null
      connection.inputStream.use { it.readBytes() }
    } catch (error: Exception) {
      null
    } finally {
      connection?.disconnect()
    }
  }
}
