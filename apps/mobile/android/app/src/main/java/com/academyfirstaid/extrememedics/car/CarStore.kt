package com.academyfirstaid.extrememedics.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONObject

/**
 * The single piece of state shared between the React Native runtime and the
 * Android Auto car app. Both live in this process; neither owns the other.
 *
 * Writes come from JS (`CarBridgeModule`). Reads come from the car screens and
 * the map renderer. Everything published here is immutable, so the render
 * thread can hold a reference without locking.
 *
 * The last payloads are also written to disk, so a car connecting to a phone
 * whose app was killed shows the last known picture immediately instead of an
 * empty map while the JS runtime boots.
 */
object CarStore {

  private const val TAG = "CarStore"
  private const val STATIC_FILE = "car-static.json"
  private const val DYNAMIC_FILE = "car-dynamic.json"
  private const val PREFS = "car-bridge"
  private const val KEY_ENABLED = "enabled"
  /** Actions raised before the JS runtime attached; replayed once it does. */
  private const val MAX_PENDING_ACTIONS = 16
  /** The dynamic payload lands at 2 Hz; the disk copy only has to be recent
   *  enough to prime the next cold start, so it is written far more rarely. */
  private const val DYNAMIC_PERSIST_INTERVAL_MS = 20_000L

  private val mainHandler = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArrayList<() -> Unit>()
  private val pendingActions = ArrayList<String>()

  @Volatile
  var staticData: CarStatic = CarStatic.EMPTY
    private set

  @Volatile
  var dynamicData: CarDynamic = CarDynamic.EMPTY
    private set

  /** True once JS has pushed at least one live payload this session — the disk
   *  snapshot is stale by definition, and the car says so until it is replaced. */
  @Volatile
  var live: Boolean = false
    private set

  /** Mirrors the phone's "Show on the car screen" switch. */
  @Volatile
  var enabled: Boolean = true
    private set

  /** Set by the car Session; read by the bridge module to notify JS. */
  @Volatile
  var carConnected: Boolean = false
    private set

  /** Installed by `CarBridgeModule` while a React context is alive. */
  @Volatile
  private var actionSink: ((String) -> Unit)? = null

  @Volatile
  private var connectionSink: ((Boolean) -> Unit)? = null

  @Volatile
  private var appContext: Context? = null

  @Volatile
  private var lastDynamicPersistAt: Long = 0L

  // ------------------------------------------------------------- lifecycle --

  /** Loads the persisted snapshot. Cheap and idempotent; call before first read. */
  fun restore(context: Context) {
    if (appContext != null) return
    val app = context.applicationContext
    appContext = app
    enabled = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)
    readFile(app, STATIC_FILE)?.let { json -> CarStatic.parse(json)?.let { staticData = it } }
    readFile(app, DYNAMIC_FILE)?.let { json -> CarDynamic.parse(json)?.let { dynamicData = it } }
  }

  fun setCarConnected(connected: Boolean) {
    if (carConnected == connected) return
    carConnected = connected
    connectionSink?.invoke(connected)
  }

  // ------------------------------------------------------------- JS writes --

  fun updateStatic(raw: String) {
    val parsed = try {
      CarStatic.parse(JSONObject(raw))
    } catch (error: Exception) {
      Log.w(TAG, "unparseable static payload", error)
      null
    } ?: return
    staticData = parsed
    live = true
    persist(STATIC_FILE, raw)
    notifyListeners()
  }

  fun updateDynamic(raw: String) {
    val parsed = try {
      CarDynamic.parse(JSONObject(raw))
    } catch (error: Exception) {
      Log.w(TAG, "unparseable dynamic payload", error)
      null
    } ?: return
    dynamicData = parsed
    live = true
    val now = android.os.SystemClock.elapsedRealtime()
    if (now - lastDynamicPersistAt >= DYNAMIC_PERSIST_INTERVAL_MS) {
      lastDynamicPersistAt = now
      persist(DYNAMIC_FILE, raw)
    }
    notifyListeners()
  }

  fun setEnabled(next: Boolean) {
    if (enabled == next) return
    enabled = next
    appContext
      ?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      ?.edit()
      ?.putBoolean(KEY_ENABLED, next)
      ?.apply()
    notifyListeners()
  }

  // ------------------------------------------------------------ car writes --

  /** Sends an action to JS, queueing it if the runtime has not attached yet. */
  fun dispatch(action: JSONObject) {
    val json = action.toString()
    val sink = actionSink
    if (sink != null) {
      sink(json)
      return
    }
    synchronized(pendingActions) {
      if (pendingActions.size >= MAX_PENDING_ACTIONS) pendingActions.removeAt(0)
      pendingActions.add(json)
    }
  }

  fun attachSinks(onAction: (String) -> Unit, onConnection: (Boolean) -> Unit) {
    actionSink = onAction
    connectionSink = onConnection
    val queued = synchronized(pendingActions) {
      val copy = ArrayList(pendingActions)
      pendingActions.clear()
      copy
    }
    for (item in queued) onAction(item)
    // The car may already be connected — JS needs to know that, not just future
    // transitions, or a headless start would never begin pushing.
    if (carConnected) onConnection(true)
  }

  fun detachSinks() {
    actionSink = null
    connectionSink = null
  }

  // --------------------------------------------------------------- readers --

  /** Listener fires on the main thread whenever any published state changes. */
  fun addListener(listener: () -> Unit) {
    listeners.add(listener)
  }

  fun removeListener(listener: () -> Unit) {
    listeners.remove(listener)
  }

  private fun notifyListeners() {
    mainHandler.post {
      for (listener in listeners) {
        try {
          listener()
        } catch (error: Exception) {
          // One bad screen must not stop the others from refreshing.
          Log.w(TAG, "car store listener failed", error)
        }
      }
    }
  }

  // ------------------------------------------------------------ persistence --

  private fun persist(name: String, raw: String) {
    val context = appContext ?: return
    // Off the caller's thread: this runs on every dynamic push (2 Hz).
    persistExecutor.execute {
      try {
        File(context.filesDir, name).writeText(raw)
      } catch (error: Exception) {
        Log.w(TAG, "car snapshot persist failed", error)
      }
    }
  }

  private fun readFile(context: Context, name: String): JSONObject? = try {
    val file = File(context.filesDir, name)
    if (file.exists()) JSONObject(file.readText()) else null
  } catch (error: Exception) {
    Log.w(TAG, "car snapshot restore failed", error)
    null
  }

  private val persistExecutor = java.util.concurrent.Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "car-store-persist").apply { isDaemon = true }
  }
}
