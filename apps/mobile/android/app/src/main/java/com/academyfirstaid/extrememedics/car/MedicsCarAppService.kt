package com.academyfirstaid.extrememedics.car

import androidx.car.app.CarAppService
import androidx.car.app.Session
import androidx.car.app.validation.HostValidator
import com.academyfirstaid.extrememedics.BuildConfig

/**
 * Entry point for the Android Auto projection.
 *
 * The app is declared in the NAVIGATION car category, which is what allows it
 * to draw its own map onto the car surface and to use the turn-by-turn
 * navigation template. That declaration lives in the manifest (generated from
 * `app.config.ts`, so a prebuild cannot silently drop it).
 */
class MedicsCarAppService : CarAppService() {

  override fun createHostValidator(): HostValidator =
    if (BuildConfig.DEBUG) {
      // Debug builds are driven from the Desktop Head Unit, which is not in the
      // signed allow-list. Release builds accept only Google's own hosts.
      HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    } else {
      HostValidator.Builder(applicationContext)
        .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
        .build()
    }

  override fun onCreateSession(): Session = MedicsSession()
}
