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
import com.academyfirstaid.extrememedics.car.CarStore
import com.academyfirstaid.extrememedics.car.map.MapGeometry

/**
 * Open incidents, nearest first. The distance is computed on the phone against
 * the same GPS fix everything else uses, so the ordering here and on the phone
 * map can never disagree.
 */
class CarIncidentsScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) = CarStore.removeListener(storeListener)

  override fun onGetTemplate(): Template {
    val dynamic = CarStore.dynamicData
    val incidents = dynamic.openIncidents.take(carContext.listRowLimit())
    val list = ItemList.Builder()

    if (incidents.isEmpty()) {
      list.setNoItemsMessage("No open incidents")
    } else {
      for (incident in incidents) {
        val distance = incident.distanceMeters?.let { MapGeometry.formatDistance(it.toDouble()) + " away" }
        val detail = listOfNotNull(
          distance,
          incident.incidentType?.replaceFirstChar { it.uppercase() },
          if (incident.assignedToMe) "Assigned to you" else null,
        ).joinToString(" · ")

        list.addItem(
          Row.Builder()
            .setTitle(incident.label)
            .addText(detail.ifEmpty { "Open incident" })
            .setBrowsable(true)
            .setOnClickListener {
              screenManager.push(CarIncidentDetailScreen(carContext, incident.id))
            }
            .build(),
        )
      }
    }

    return ListTemplate.Builder()
      .setTitle("Incidents")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }
}
