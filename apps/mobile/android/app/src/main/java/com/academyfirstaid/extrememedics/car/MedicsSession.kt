package com.academyfirstaid.extrememedics.car

import android.content.Intent
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.academyfirstaid.extrememedics.car.screens.CarMapScreen

/**
 * One car session. Owns the root screen and the bridge's "car is connected"
 * signal, which is what makes the JS side start (and stop) mirroring state.
 *
 * The root screen never changes identity: {@link CarMapScreen} decides for
 * itself, on every template request, whether to show the map or a notice
 * ("sign in on your phone", "Android Auto is switched off"). Swapping root
 * screens for those states would fight the host's back stack.
 */
class MedicsSession : Session(), DefaultLifecycleObserver {

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreateScreen(intent: Intent): Screen {
    CarStore.restore(carContext)
    // Kicking React Native awake here (rather than on first draw) gives the JS
    // runtime the whole template round-trip to connect before anyone looks.
    CarHeadlessStarter.ensureRunning(carContext)
    return CarMapScreen(carContext)
  }

  override fun onCreate(owner: LifecycleOwner) {
    CarStore.setCarConnected(true)
  }

  override fun onDestroy(owner: LifecycleOwner) {
    CarStore.setCarConnected(false)
  }
}
