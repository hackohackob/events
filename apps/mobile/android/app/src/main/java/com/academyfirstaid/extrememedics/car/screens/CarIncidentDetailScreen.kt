package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.academyfirstaid.extrememedics.car.CarActions
import com.academyfirstaid.extrememedics.car.CarStore
import com.academyfirstaid.extrememedics.car.map.MapGeometry

/**
 * One incident, with the two things worth doing about it from a moving bike:
 * navigate to it, and mark yourself as responding.
 */
class CarIncidentDetailScreen(
  carContext: CarContext,
  private val incidentId: String,
) : Screen(carContext), DefaultLifecycleObserver {

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) = CarStore.removeListener(storeListener)

  override fun onGetTemplate(): Template {
    val dynamic = CarStore.dynamicData
    val incident = dynamic.markers.firstOrNull { it.id == incidentId }
      ?: return MessageTemplate.Builder("This incident is no longer open.")
        .setTitle("Incident")
        .setHeaderAction(Action.BACK)
        .build()

    val pane = Pane.Builder()

    pane.addRow(
      Row.Builder()
        .setTitle(incident.label)
        .addText(
          listOfNotNull(
            incident.incidentType?.replaceFirstChar { it.uppercase() },
            incident.incidentStatus?.replaceFirstChar { it.uppercase() },
          ).joinToString(" · ").ifEmpty { "Open" },
        )
        .build(),
    )

    incident.distanceMeters?.let { meters ->
      pane.addRow(
        Row.Builder()
          .setTitle("Distance")
          .addText(MapGeometry.formatDistance(meters.toDouble()) + " away")
          .build(),
      )
    }

    if (incident.assignedToMe) {
      pane.addRow(Row.Builder().setTitle("You are responding").addText("Assigned to this incident").build())
    }

    pane.addAction(
      Action.Builder()
        .setTitle(if (dynamic.nav.active) "Re-route here" else "Navigate")
        .setOnClickListener {
          CarActions.navigateTo(incident.lat, incident.lng, incident.label, incident.id)
          // Straight back to the map — that is where the guidance appears.
          screenManager.popToRoot()
        }
        .build(),
    )

    // Only medics respond to incidents; a runner's car app is read-only here.
    if (dynamic.isMedic) {
      pane.addAction(
        Action.Builder()
          .setTitle(if (incident.assignedToMe) "Stand down" else "Respond")
          .setOnClickListener {
            if (incident.assignedToMe) CarActions.standDown(incident.id)
            else CarActions.respond(incident.id)
          }
          .build(),
      )
    }

    return PaneTemplate.Builder(pane.build())
      .setTitle("Incident")
      .setHeaderAction(Action.BACK)
      .build()
  }
}
