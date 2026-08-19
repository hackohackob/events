package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.academyfirstaid.extrememedics.car.CarActions
import com.academyfirstaid.extrememedics.car.CarStore

/**
 * The "More" menu. Kept to a handful of rows because Android Auto refuses long
 * lists while driving — and because a menu you have to read is a menu you
 * should not be opening at speed.
 */
class CarMenuScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) = CarStore.removeListener(storeListener)

  override fun onGetTemplate(): Template {
    val dynamic = CarStore.dynamicData
    val list = ItemList.Builder()

    list.addItem(
      Row.Builder()
        .setTitle("Voice message")
        .addText(if (dynamic.recording) "Recording — tap to finish" else "Send a voice note to the team")
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(CarVoiceScreen(carContext)) }
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle(if (dynamic.nav.voiceMuted) "Turn voice guidance on" else "Mute voice guidance")
        .addText(if (dynamic.nav.voiceMuted) "Spoken turns are muted" else "Spoken turn-by-turn is on")
        .setOnClickListener { CarActions.toggleVoiceMute() }
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Settings")
        .addText("Reporting cadence and map options")
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(CarSettingsScreen(carContext)) }
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Location diagnostics")
        .addText(diagnosticsSummary())
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(CarDiagnosticsScreen(carContext)) }
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Build info")
        .addText(CarStore.staticData.build.appVersion)
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(CarBuildInfoScreen(carContext)) }
        .build(),
    )

    return ListTemplate.Builder()
      .setTitle("More")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }

  private fun diagnosticsSummary(): String {
    val diagnostics = CarStore.dynamicData.diagnostics
    return when {
      diagnostics.trackingIssues.isNotEmpty() -> diagnostics.trackingIssues.first()
      !diagnostics.socketConnected -> "Not connected to the server"
      else -> "GPS, network and battery"
    }
  }
}
