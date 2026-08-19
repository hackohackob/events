package com.academyfirstaid.extrememedics.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication

/**
 * Starts the React Native runtime when Android Auto connects to a phone whose
 * app is not running.
 *
 * The car app itself is pure native and works from the persisted snapshot alone,
 * but live positions, incidents and navigation all come from JS — so the runtime
 * has to come up. `index.js` installs the car bridge at module load precisely so
 * that this works with no Activity and no React tree: there is no UI to mount,
 * and none is created here.
 *
 * If the runtime is already alive (the normal case — the medic is on duty with
 * the app open behind a foreground service) this is a no-op.
 */
object CarHeadlessStarter {

  private const val TAG = "CarHeadlessStarter"

  @Volatile
  private var startRequested = false

  fun ensureRunning(context: Context) {
    val application = context.applicationContext as? ReactApplication ?: return

    // ReactHost must be touched from the main thread.
    Handler(Looper.getMainLooper()).post {
      try {
        val host = application.reactHost ?: run {
          Log.w(TAG, "no react host — car stays on its cached snapshot")
          return@post
        }
        // Already up — the medic has the app open, which is the normal case.
        if (host.currentReactContext != null) {
          startRequested = false
          return@post
        }
        if (startRequested) return@post
        startRequested = true
        Log.i(TAG, "starting react runtime for android auto")
        host.start()
      } catch (error: Exception) {
        // A failed headless start leaves the car on its cached snapshot, which
        // is a degraded screen — never a crash in front of a moving vehicle.
        Log.e(TAG, "headless react start failed", error)
      }
    }
  }
}
