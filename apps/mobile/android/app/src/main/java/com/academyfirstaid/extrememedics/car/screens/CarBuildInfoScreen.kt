package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import com.academyfirstaid.extrememedics.car.CarStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Which build is actually running — the question this screen exists to answer
 * on the phone too: did the OTA land on this device?
 */
class CarBuildInfoScreen(carContext: CarContext) : Screen(carContext) {

  override fun onGetTemplate(): Template {
    val build = CarStore.staticData.build
    val list = ItemList.Builder()

    list.addItem(
      Row.Builder()
        .setTitle("App version")
        .addText("${build.appVersion} · native build ${build.nativeBuild}")
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Runtime")
        .addText("${build.runtimeVersion}${build.channel?.let { " · $it" } ?: ""}")
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Update")
        .addText(
          build.updateId?.let { id -> "${id.take(8)} · applied ${stamp(build.updateAppliedAt)}" }
            ?: "Embedded bundle (no OTA)",
        )
        .build(),
    )

    list.addItem(
      Row.Builder()
        .setTitle("Car link")
        .addText(if (CarStore.live) "Live from the phone" else "Cached snapshot — phone not reporting")
        .build(),
    )

    return ListTemplate.Builder()
      .setTitle("Build info")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }

  private fun stamp(at: Long?): String {
    if (at == null || at <= 0) return "unknown"
    return SimpleDateFormat("d MMM HH:mm", Locale.getDefault()).format(Date(at))
  }
}
