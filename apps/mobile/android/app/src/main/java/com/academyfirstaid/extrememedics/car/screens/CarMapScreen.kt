package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Distance
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.navigation.NavigationManager
import androidx.car.app.navigation.NavigationManagerCallback
import androidx.car.app.navigation.model.Destination
import androidx.car.app.navigation.model.MessageInfo
import androidx.car.app.navigation.model.NavigationTemplate
import androidx.car.app.navigation.model.RoutingInfo
import androidx.car.app.navigation.model.Step
import androidx.car.app.navigation.model.Trip
import androidx.car.app.navigation.model.TravelEstimate
import androidx.core.graphics.drawable.IconCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.academyfirstaid.extrememedics.R
import com.academyfirstaid.extrememedics.car.CarActions
import com.academyfirstaid.extrememedics.car.CarAlerts
import com.academyfirstaid.extrememedics.car.CarDynamic
import com.academyfirstaid.extrememedics.car.CarStore
import com.academyfirstaid.extrememedics.car.map.CarMapRenderer
import com.academyfirstaid.extrememedics.car.map.CarManeuvers
import com.academyfirstaid.extrememedics.car.map.MapGeometry
import java.util.concurrent.TimeUnit

/**
 * The car's home screen: the live map, with turn-by-turn guidance layered over
 * it when the medic is navigating.
 *
 * It is also the app's only long-lived screen, so it owns the map renderer, the
 * navigation-manager handshake with the host, and the dispatch alert.
 */
class CarMapScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private val renderer = CarMapRenderer(carContext)
  private val navigationManager = carContext.getCarService(NavigationManager::class.java)
  private val alerts = CarAlerts(carContext)

  /** Whether we have told the host we are navigating. Mismatching this against
   *  the real state is what makes the host reject a RoutingInfo template. */
  private var navigationActive = false

  /** Last banner text shown, so one message is not toasted on every refresh. */
  private var lastToast: String? = null

  private val storeListener: () -> Unit = {
    invalidate()
    // A newly assigned incident raises the car's own alert, falling back to a
    // pushed screen on hosts too old for the Alert API.
    alerts.check { screen -> screenManager.push(screen) }
    surfaceToast()
  }

  /**
   * Mirrors the phone's transient messages ("Routing to…", "No route found",
   * "Waiting for a GPS fix") onto the car. Without this the car silently did
   * nothing when an action failed, which on a moving bike is indistinguishable
   * from a dead app.
   */
  private fun surfaceToast() {
    val toast = CarStore.dynamicData.toast
    if (toast == lastToast) return
    lastToast = toast
    if (toast.isNullOrBlank()) return
    try {
      CarToast.makeText(carContext, toast, CarToast.LENGTH_LONG).show()
    } catch (error: Exception) {
      // A host that refuses toasts still gets the text in the banner below.
    }
  }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) {
    carContext.getCarService(androidx.car.app.AppManager::class.java).setSurfaceCallback(renderer)
    navigationManager.setNavigationManagerCallback(object : NavigationManagerCallback {
      override fun onStopNavigation() {
        // The host (or another nav app taking over) is telling us to stop.
        // Route it through the phone so both screens agree.
        CarActions.stopNavigation()
        navigationActive = false
      }

      override fun onAutoDriveEnabled() = Unit
    })
    CarStore.addListener(storeListener)
  }

  override fun onDestroy(owner: LifecycleOwner) {
    CarStore.removeListener(storeListener)
    if (navigationActive) {
      navigationManager.navigationEnded()
      navigationActive = false
    }
    navigationManager.clearNavigationManagerCallback()
    renderer.destroy()
  }

  override fun onGetTemplate(): Template {
    val dynamic = CarStore.dynamicData

    if (!CarStore.enabled) {
      return notice(
        "Android Auto is switched off for Extreme Medics",
        "Turn it back on in the app's Settings on your phone.",
      )
    }
    if (dynamic.hydrated && !dynamic.signedIn) {
      return notice("Not signed in", "Open Extreme Medics on your phone and join an event.")
    }

    syncNavigationState(dynamic)

    // Deliberately no setBackgroundColor: the only colours a car app may pass
    // are theme-relative, and this app defines no car theme — the host painted
    // the navigation card magenta. The host's own default is correct, and
    // legible in both the car's day and night modes.
    val builder = NavigationTemplate.Builder()
      .setActionStrip(actionStrip(dynamic))
      .setMapActionStrip(mapActionStrip())

    if (dynamic.nav.active) {
      routingInfo(dynamic)?.let { builder.setNavigationInfo(it) }
      travelEstimate(dynamic)?.let { builder.setDestinationTravelEstimate(it) }
    } else {
      builder.setNavigationInfo(MessageInfo.Builder(idleMessage(dynamic)).build())
    }

    return builder.build()
  }

  // ------------------------------------------------------------ navigation --

  /**
   * Keeps the host's idea of "this app is navigating" in step with the phone's.
   * `navigationStarted()` must be called before a RoutingInfo template, and
   * `navigationEnded()` when guidance stops — the host uses the pair to hand the
   * navigation focus (and the cluster display) between apps.
   */
  private fun syncNavigationState(dynamic: CarDynamic) {
    val shouldBeActive = dynamic.nav.active
    if (shouldBeActive && !navigationActive) {
      navigationManager.navigationStarted()
      navigationActive = true
    } else if (!shouldBeActive && navigationActive) {
      navigationManager.navigationEnded()
      navigationActive = false
    }
    if (navigationActive) publishTrip(dynamic)
  }

  /** Feeds the instrument cluster / heads-up display, where the car has one. */
  private fun publishTrip(dynamic: CarDynamic) {
    val step = CarManeuvers.step(dynamic.nav) ?: return
    val estimate = travelEstimate(dynamic) ?: return
    val trip = Trip.Builder()
      .addDestination(
        Destination.Builder().setName(dynamic.nav.destinationLabel ?: "Destination").build(),
        estimate,
      )
      .addStep(step, stepEstimate(dynamic))
      .setCurrentRoad(dynamic.nav.road ?: "")
      .build()
    navigationManager.updateTrip(trip)
  }

  private fun routingInfo(dynamic: CarDynamic): RoutingInfo? {
    if (dynamic.nav.offRoute) {
      // The host renders the loading state as "recalculating", which is exactly
      // what an off-route medic is waiting on. It is mutually exclusive with a
      // step, hence the early return.
      return RoutingInfo.Builder().setLoading(true).build()
    }
    val step = CarManeuvers.step(dynamic.nav) ?: return null
    val distance = CarManeuvers.distance(dynamic.nav.toManeuverMeters) ?: return null
    return RoutingInfo.Builder().setCurrentStep(step, distance).build()
  }

  private fun travelEstimate(dynamic: CarDynamic): TravelEstimate? {
    val remainingMeters = dynamic.nav.remainingMeters ?: return null
    val distance = CarManeuvers.distance(remainingMeters) ?: return null
    val remainingMs = dynamic.nav.remainingMs
    // Track-following has no engine ETA; the car then shows distance only, and
    // an arrival time far enough out that the host renders it as unknown.
    val arrival = CarManeuvers.arrivalTime(remainingMs)
    val builder = TravelEstimate.Builder(distance, arrival)
    if (remainingMs != null) {
      builder.setRemainingTimeSeconds(TimeUnit.MILLISECONDS.toSeconds(remainingMs))
      builder.setRemainingTimeColor(CarColor.GREEN)
    }
    return builder.build()
  }

  private fun stepEstimate(dynamic: CarDynamic): TravelEstimate {
    val meters = dynamic.nav.toManeuverMeters ?: 0.0
    val distance = CarManeuvers.distance(meters) ?: Distance.create(0.0, Distance.UNIT_METERS)
    return TravelEstimate.Builder(distance, CarManeuvers.arrivalTime(null)).build()
  }

  private fun idleMessage(dynamic: CarDynamic): CharSequence {
    // A live message from the phone outranks the standing summary.
    dynamic.toast?.takeIf { it.isNotBlank() }?.let { return it }
    if (!CarStore.live) return "Reconnecting to the phone…"
    val assigned = dynamic.assignedIncident
    if (assigned != null) return "Assigned: ${assigned.label}"
    val open = dynamic.openIncidents.size
    val event = dynamic.eventTitle ?: "Extreme Medics"
    return when {
      open == 0 -> "$event · no open incidents"
      open == 1 -> "$event · 1 open incident"
      else -> "$event · $open open incidents"
    }
  }

  // ---------------------------------------------------------------- actions --

  private fun actionStrip(dynamic: CarDynamic): ActionStrip {
    val builder = ActionStrip.Builder()

    if (dynamic.nav.active) {
      builder.addAction(
        Action.Builder()
          .setTitle("Stop")
          .setOnClickListener { CarActions.stopNavigation() }
          .build(),
      )
    }

    builder.addAction(
      Action.Builder()
        .setTitle(incidentsLabel(dynamic))
        .setOnClickListener { screenManager.push(CarIncidentsScreen(carContext)) }
        .build(),
    )

    if (dynamic.isMedic) {
      builder.addAction(
        Action.Builder()
          .setTitle("Status")
          .setOnClickListener { screenManager.push(CarStatusScreen(carContext)) }
          .build(),
      )
    }

    builder.addAction(
      Action.Builder()
        .setTitle("More")
        .setOnClickListener { screenManager.push(CarMenuScreen(carContext)) }
        .build(),
    )

    return builder.build()
  }

  private fun incidentsLabel(dynamic: CarDynamic): String {
    val open = dynamic.openIncidents.size
    return if (open > 0) "Incidents ($open)" else "Incidents"
  }

  /** Map controls. These must be icon-only — the host refuses titles here. */
  private fun mapActionStrip(): ActionStrip = ActionStrip.Builder()
    .addAction(iconAction(R.drawable.car_ic_recenter) { renderer.recenter() })
    .addAction(iconAction(R.drawable.car_ic_compass) { renderer.toggleOrientation() })
    .addAction(iconAction(R.drawable.car_ic_zoom_in) { renderer.zoomBy(1.0) })
    .addAction(iconAction(R.drawable.car_ic_zoom_out) { renderer.zoomBy(-1.0) })
    .build()

  private fun iconAction(iconRes: Int, onClick: () -> Unit): Action = Action.Builder()
    .setIcon(CarIcon.Builder(IconCompat.createWithResource(carContext, iconRes)).build())
    .setOnClickListener { onClick() }
    .build()

  private fun notice(title: String, body: String): Template = MessageTemplate.Builder(body)
    .setTitle(title)
    .setHeaderAction(Action.APP_ICON)
    .build()
}
