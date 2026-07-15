package com.academyfirstaid.racesafe

import android.content.Context
import android.os.PowerManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class PowerManagerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "PowerManagerModule"

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    try {
      val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(powerManager.isIgnoringBatteryOptimizations(reactContext.packageName))
    } catch (error: Exception) {
      promise.reject("POWER_MANAGER_ERROR", error)
    }
  }
}
