package com.academyfirstaid.extrememedics.car

import com.academyfirstaid.extrememedics.car.map.CarTileCache
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject

/**
 * JS ⇄ car app bridge. Deliberately a plain (legacy) native module, matching
 * `PowerManagerModule` — the New Architecture interop layer runs these fine and
 * it keeps the surface small enough to reason about.
 *
 * Events emitted to JS:
 *  - `CarBridge:connected` — Android Auto attached/detached
 *  - `CarBridge:action`    — a car screen asked the phone to do something
 *  - `CarBridge:prefetch`  — offline tile download progress
 */
class CarBridgeModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  private val tileCache = CarTileCache.get(reactContext)

  init {
    CarStore.restore(reactContext)
    reactContext.addLifecycleEventListener(this)
    CarStore.attachSinks(
      onAction = { json -> emit("CarBridge:action", Arguments.createMap().apply { putString("json", json) }) },
      onConnection = { connected ->
        emit("CarBridge:connected", Arguments.createMap().apply { putBoolean("connected", connected) })
      },
    )
  }

  override fun getName(): String = "CarBridgeModule"

  override fun invalidate() {
    CarStore.detachSinks()
    tileCache.cancelPrefetch()
    reactContext.removeLifecycleEventListener(this)
    super.invalidate()
  }

  override fun onHostResume() = Unit
  override fun onHostPause() = Unit
  override fun onHostDestroy() = Unit

  // ------------------------------------------------------------- JS → car --

  @ReactMethod
  fun setEnabled(enabled: Boolean) {
    CarStore.setEnabled(enabled)
  }

  @ReactMethod
  fun pushStatic(json: String) {
    CarStore.updateStatic(json)
  }

  @ReactMethod
  fun pushDynamic(json: String) {
    CarStore.updateDynamic(json)
  }

  @ReactMethod
  fun isCarConnected(promise: Promise) {
    promise.resolve(CarStore.carConnected)
  }

  // ---------------------------------------------------------- tile cache ----

  @ReactMethod
  fun prefetchTiles(json: String, promise: Promise) {
    try {
      val request = JSONObject(json)
      val requested = tileCache.prefetch(
        minLat = request.getDouble("minLat"),
        minLng = request.getDouble("minLng"),
        maxLat = request.getDouble("maxLat"),
        maxLng = request.getDouble("maxLng"),
        minZoom = request.getInt("minZoom"),
        maxZoom = request.getInt("maxZoom"),
        urlTemplate = request.getString("tileUrlTemplate"),
      ) { done, total, bytes, finished, error ->
        emit(
          "CarBridge:prefetch",
          Arguments.createMap().apply {
            putInt("done", done)
            putInt("total", total)
            putDouble("bytes", bytes.toDouble())
            putBoolean("finished", finished)
            if (error != null) putString("error", error)
          },
        )
      }
      promise.resolve(Arguments.createMap().apply { putInt("requested", requested) })
    } catch (error: Exception) {
      promise.reject("CAR_PREFETCH_ERROR", error)
    }
  }

  @ReactMethod
  fun cancelPrefetch() {
    tileCache.cancelPrefetch()
  }

  @ReactMethod
  fun tileCacheStats(promise: Promise) {
    tileCache.stats { tiles, bytes ->
      promise.resolve(
        Arguments.createMap().apply {
          putInt("tiles", tiles)
          putDouble("bytes", bytes.toDouble())
        },
      )
    }
  }

  @ReactMethod
  fun clearTileCache(promise: Promise) {
    tileCache.clear { promise.resolve(null) }
  }

  // NativeEventEmitter contract. Unused (JS listens via DeviceEventEmitter),
  // but RN warns loudly without them.
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  private fun emit(event: String, payload: WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(event, payload)
    } catch (error: Exception) {
      // A torn-down runtime is not an error worth propagating into the car.
    }
  }
}
