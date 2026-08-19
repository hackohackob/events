package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.model.Toggle
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.academyfirstaid.extrememedics.car.CarActions
import com.academyfirstaid.extrememedics.car.CarStore

/**
 * The settings that survive the trip to a car screen.
 *
 * Android Auto has no slider and no text field, and refuses a long list while
 * driving — so numeric settings become short preset lists on their own screen,
 * and everything else is a switch. What is deliberately NOT here: anything that
 * only makes sense while looking at the phone map (zone visibility, layer
 * pickers) and anything destructive.
 */
class CarSettingsScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) = CarStore.removeListener(storeListener)

  override fun onGetTemplate(): Template {
    val settings = CarStore.dynamicData.settings
    val list = ItemList.Builder()

    list.addItem(
      Row.Builder()
        .setTitle("Reporting cadence")
        .addText(CarIntervalScreen.label(settings.locationIntervalMs))
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(CarIntervalScreen(carContext)) }
        .build(),
    )

    // A row carrying a toggle must not also carry a click listener — the host
    // rejects the template outright if it does.
    list.addItem(
      Row.Builder()
        .setTitle("Spread overlapping tracks")
        .addText("Draw shared paths side by side")
        .setToggle(
          Toggle.Builder { checked -> CarActions.setSetting("trackOffsetEnabled", checked) }
            .setChecked(settings.trackOffsetEnabled)
            .build(),
        )
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Track gradient shading")
        .addText("Shade tracks by slope instead of a flat colour")
        .setToggle(
          Toggle.Builder { checked -> CarActions.setSetting("trackGradientEnabled", checked) }
            .setChecked(settings.trackGradientEnabled)
            .build(),
        )
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Km markers")
        .addText("Distance chips along tracks")
        .setToggle(
          Toggle.Builder { checked -> CarActions.setSetting("kmMarkersEnabled", checked) }
            .setChecked(settings.kmMarkersEnabled)
            .build(),
        )
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Voice guidance")
        .addText("Spoken turn-by-turn")
        .setToggle(
          Toggle.Builder { checked -> CarActions.setSetting("voiceMuted", !checked) }
            .setChecked(!settings.voiceMuted)
            .build(),
        )
        .build(),
    )

    return ListTemplate.Builder()
      .setTitle("Settings")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }
}
