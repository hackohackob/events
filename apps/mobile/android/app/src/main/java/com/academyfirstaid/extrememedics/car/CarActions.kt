package com.academyfirstaid.extrememedics.car

import org.json.JSONObject

/**
 * Every request the car screens can make of the phone.
 *
 * Each one is a message onto the bridge; none of them changes app state here.
 * That is the whole point: the phone runs the action through the same store
 * function its own UI uses, so the two screens can never drift apart.
 * See `apps/mobile/src/car/car-bridge.ts` for the receiving end.
 */
object CarActions {

  fun navigateTo(lat: Double, lng: Double, label: String, incidentId: String? = null) {
    val action = JSONObject()
      .put("type", "navigate")
      .put("lat", lat)
      .put("lng", lng)
      .put("label", label)
    if (incidentId != null) action.put("incidentId", incidentId)
    CarStore.dispatch(action)
  }

  fun stopNavigation() = CarStore.dispatch(JSONObject().put("type", "stopNav"))

  fun toggleVoiceMute() = CarStore.dispatch(JSONObject().put("type", "toggleVoiceMute"))

  fun setStatus(status: String) =
    CarStore.dispatch(JSONObject().put("type", "setStatus").put("status", status))

  fun respond(incidentId: String) =
    CarStore.dispatch(JSONObject().put("type", "respond").put("incidentId", incidentId))

  fun standDown(incidentId: String) =
    CarStore.dispatch(JSONObject().put("type", "standDown").put("incidentId", incidentId))

  fun setSetting(key: String, value: Boolean) =
    CarStore.dispatch(JSONObject().put("type", "setSetting").put("key", key).put("value", value))

  fun setSetting(key: String, value: Long) =
    CarStore.dispatch(JSONObject().put("type", "setSetting").put("key", key).put("value", value))

  fun startRecording() = CarStore.dispatch(JSONObject().put("type", "recordStart"))

  fun stopRecording(send: Boolean) =
    CarStore.dispatch(JSONObject().put("type", "recordStop").put("send", send))

  fun requestRefresh() = CarStore.dispatch(JSONObject().put("type", "requestRefresh"))
}
