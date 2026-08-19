package com.academyfirstaid.extrememedics.car

import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.Alert
import androidx.car.app.model.AlertCallback
import androidx.car.app.model.CarText
import com.academyfirstaid.extrememedics.car.screens.CarIncidentDetailScreen

/**
 * Raises the car's own alert when this medic is assigned to an incident, so the
 * job arrives on the screen in front of the rider instead of on a phone in a
 * pocket.
 *
 * Audio is untouched: the incident siren still comes from the phone exactly as
 * it does today. This is the visual half only.
 */
class CarAlerts(private val carContext: CarContext) {

  companion object {
    private const val TAG = "CarAlerts"
    /** How long the alert stays up before the host dismisses it. */
    private const val ALERT_DURATION_MS = 15_000L
    /** `AppManager.showAlert` arrived at car API level 5. */
    private const val ALERT_API_LEVEL = 5
  }

  /** The incident we last alerted for, so a re-render cannot re-alert. */
  private var alertedIncidentId: String? = null
  private var nextAlertId = 1

  /**
   * Call whenever the shared state changes. Raises an alert the first time a
   * given incident becomes this medic's assignment, and nothing thereafter.
   *
   * @param pushScreen fallback used on hosts without the Alert API.
   */
  fun check(pushScreen: (Screen) -> Unit) {
    val dynamic = CarStore.dynamicData
    val assigned = dynamic.assignedIncident

    if (assigned == null) {
      // Cleared (stood down, resolved) — the next assignment may alert again.
      alertedIncidentId = null
      return
    }
    if (assigned.id == alertedIncidentId) return
    alertedIncidentId = assigned.id

    val title = "Assigned: ${assigned.label}"
    val subtitle = assigned.distanceMeters
      ?.let { com.academyfirstaid.extrememedics.car.map.MapGeometry.formatDistance(it.toDouble()) + " away" }
      ?: "Distance unknown"

    if (carContext.carAppApiLevel < ALERT_API_LEVEL) {
      pushScreen(CarIncidentDetailScreen(carContext, assigned.id))
      return
    }

    val alert = Alert.Builder(nextAlertId++, CarText.create(title), ALERT_DURATION_MS)
      .setSubtitle(CarText.create(subtitle))
      .addAction(
        Action.Builder()
          .setTitle("Navigate")
          .setOnClickListener {
            CarActions.respond(assigned.id)
            CarActions.navigateTo(assigned.lat, assigned.lng, assigned.label, assigned.id)
          }
          .build(),
      )
      .addAction(
        Action.Builder()
          .setTitle("Details")
          .setOnClickListener { pushScreen(CarIncidentDetailScreen(carContext, assigned.id)) }
          .build(),
      )
      .setCallback(object : AlertCallback {
        override fun onCancel(reason: Int) = Unit
        override fun onDismiss() = Unit
      })
      .build()

    try {
      carContext.getCarService(AppManager::class.java).showAlert(alert)
    } catch (error: Exception) {
      // Some hosts refuse alerts outright (or while another one is showing).
      // A toast plus the map banner is a poor second, but never a crash.
      Log.w(TAG, "car alert refused", error)
      CarToast.makeText(carContext, title, CarToast.LENGTH_LONG).show()
    }
  }
}
