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
 * Set your own status from the car. Mirrors the phone's status control: the
 * "going to" state is set by navigating, not chosen, so it is shown but never
 * offered.
 */
class CarStatusScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private companion object {
    /** Selectable statuses, in the order the phone lists them. */
    val OPTIONS = listOf(
      "available" to ("Available" to "Ready for the next job"),
      "stationary" to ("Stationary" to "Holding a post — reports less often to save battery"),
      "sweeper" to ("Sweeper" to "Riding the tail of the field"),
      "rest" to ("Rest" to "Off the board for now"),
    )
  }

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) = CarStore.removeListener(storeListener)

  override fun onGetTemplate(): Template {
    val current = CarStore.dynamicData.myStatus
    val list = ItemList.Builder()

    if (current == "going_to") {
      list.addItem(
        Row.Builder()
          .setTitle("Going to")
          .addText("Currently navigating — pick another status to stand down")
          .build(),
      )
    }

    for ((value, labels) in OPTIONS) {
      val (title, subtitle) = labels
      val selected = value == current
      list.addItem(
        Row.Builder()
          .setTitle(if (selected) "$title ✓" else title)
          .addText(subtitle)
          .setOnClickListener {
            if (!selected) CarActions.setStatus(value)
            screenManager.pop()
          }
          .build(),
      )
    }

    return ListTemplate.Builder()
      .setTitle("My status")
      .setHeaderAction(Action.BACK)
      .setSingleList(list.build())
      .build()
  }
}
