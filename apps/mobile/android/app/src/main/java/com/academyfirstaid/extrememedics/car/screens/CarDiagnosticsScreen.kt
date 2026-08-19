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
import com.academyfirstaid.extrememedics.car.CarDiagnostics
import com.academyfirstaid.extrememedics.car.CarStore
import kotlin.math.roundToInt

/**
 * Location diagnostics, read-only.
 *
 * The phone screen is a scrolling wall of detail; a car list is capped at a
 * handful of rows, so this carries the answers to "is my position actually
 * getting out?" and nothing else. Each row is one line a rider can take in at a
 * glance — the deep detail stays on the phone, where it can be read properly.
 */
class CarDiagnosticsScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) = CarStore.removeListener(storeListener)

  override fun onGetTemplate(): Template {
    val diagnostics = CarStore.dynamicData.diagnostics
    val rows = buildRows(diagnostics)
    val list = ItemList.Builder()
    for (row in rows.take(carContext.listRowLimit())) {
      list.addItem(Row.Builder().setTitle(row.first).addText(row.second).build())
    }

    return ListTemplate.Builder()
      .setTitle("Location diagnostics")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }

  /** Ordered worst-first: whatever is broken should be the first row. */
  private fun buildRows(diagnostics: CarDiagnostics): List<Pair<String, String>> {
    val rows = ArrayList<Pair<String, String>>()

    if (diagnostics.trackingIssues.isNotEmpty()) {
      rows.add("Tracking problem" to diagnostics.trackingIssues.joinToString(" · "))
    }

    rows.add(
      "GPS fix" to when (val age = diagnostics.fixAgeMs) {
        null -> "No fix yet"
        else -> {
          val accuracy = diagnostics.accuracyMeters?.let { " · ±${it.roundToInt()} m" } ?: ""
          "${ago(age)}$accuracy"
        }
      },
    )

    rows.add(
      "Server" to buildString {
        append(if (diagnostics.socketConnected) "Live" else "Not connected")
        if (!diagnostics.online) append(" · offline")
        diagnostics.lastReportAgeMs?.let { age ->
          append(" · last report ${ago(age)}")
          if (diagnostics.lastReportOk == false) append(" (failed)")
          else diagnostics.lastReportVia?.let { append(" via $it") }
        }
      },
    )

    if (diagnostics.queuedLocations > 0 || diagnostics.queuedIncidents > 0) {
      rows.add(
        "Queued" to "${diagnostics.queuedLocations} positions · ${diagnostics.queuedIncidents} incidents",
      )
    }

    rows.add(
      "Reporting every" to CarIntervalScreen.label(diagnostics.effectiveIntervalMs),
    )

    rows.add(
      "Battery" to buildString {
        append(diagnostics.batteryPercent?.let { "${it.roundToInt()}%" } ?: "Unknown")
        diagnostics.drainPercentPerHour?.let { append(" · ${String.format("%.1f", it)} %/h") }
        when (diagnostics.batteryOptimizationIgnored) {
          true -> append(" · unrestricted")
          false -> append(" · RESTRICTED")
          null -> Unit
        }
      },
    )

    return rows
  }

  private fun ago(ms: Long): String = when {
    ms < 2_000 -> "just now"
    ms < 60_000 -> "${ms / 1000}s ago"
    ms < 3_600_000 -> "${ms / 60_000} min ago"
    else -> "${ms / 3_600_000} h ago"
  }
}
