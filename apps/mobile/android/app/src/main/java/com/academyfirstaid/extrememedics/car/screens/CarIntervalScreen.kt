package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import com.academyfirstaid.extrememedics.car.CarActions
import com.academyfirstaid.extrememedics.car.CarStore

/**
 * How often this device reports its position. A phone-side dropdown becomes a
 * short list here — the full seven options would be refused as too long while
 * driving, so the car offers the ones a rider actually switches between.
 */
class CarIntervalScreen(carContext: CarContext) : Screen(carContext) {

  companion object {
    /** Subset of `LOCATION_INTERVAL_OPTIONS` from the phone's settings store. */
    private val OPTIONS = listOf(
      30_000L to "30 sec",
      60_000L to "1 min",
      180_000L to "3 min",
      300_000L to "5 min",
      1_200_000L to "20 min",
    )

    fun label(ms: Long): String =
      OPTIONS.firstOrNull { it.first == ms }?.second ?: "${ms / 60_000} min"
  }

  override fun onGetTemplate(): Template {
    val current = CarStore.dynamicData.settings.locationIntervalMs
    val list = ItemList.Builder()

    for ((ms, title) in OPTIONS.take(carContext.listRowLimit())) {
      val selected = ms == current
      list.addItem(
        Row.Builder()
          .setTitle(if (selected) "$title ✓" else title)
          .setOnClickListener {
            if (!selected) CarActions.setSetting("locationIntervalMs", ms)
            screenManager.pop()
          }
          .build(),
      )
    }

    return ListTemplate.Builder()
      .setTitle("Reporting cadence")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }
}
