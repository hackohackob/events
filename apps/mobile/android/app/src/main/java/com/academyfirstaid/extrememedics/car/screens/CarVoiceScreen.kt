package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import com.academyfirstaid.extrememedics.car.CarActions
import com.academyfirstaid.extrememedics.car.CarStore

/**
 * Record a voice note into the event chat.
 *
 * The microphone is the phone's — a paired helmet intercom on a bike — not the
 * head unit's, so this screen only starts and stops the phone's recorder. Two
 * big targets, no timers to read.
 */
class CarVoiceScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {

  private val storeListener: () -> Unit = { invalidate() }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreate(owner: LifecycleOwner) = CarStore.addListener(storeListener)

  override fun onDestroy(owner: LifecycleOwner) {
    CarStore.removeListener(storeListener)
    // Leaving the screen mid-recording would strand the phone's recorder open.
    if (CarStore.dynamicData.recording) CarActions.stopRecording(send = false)
  }

  override fun onGetTemplate(): Template {
    val dynamic = CarStore.dynamicData
    val recording = dynamic.recording

    val builder = MessageTemplate.Builder(
      dynamic.toast ?: if (recording) {
        "Recording. Speak, then send."
      } else {
        "Send a voice message to the whole team."
      },
    )
      .setTitle(if (recording) "Recording…" else "Voice message")
      .setHeaderAction(Action.BACK)

    if (recording) {
      builder.addAction(
        Action.Builder()
          .setTitle("Send")
          .setOnClickListener {
            CarActions.stopRecording(send = true)
            screenManager.pop()
          }
          .build(),
      )
      builder.addAction(
        Action.Builder()
          .setTitle("Discard")
          .setOnClickListener { CarActions.stopRecording(send = false) }
          .build(),
      )
    } else {
      builder.addAction(
        Action.Builder()
          .setTitle("Record")
          .setOnClickListener { CarActions.startRecording() }
          .build(),
      )
    }

    return builder.build()
  }
}
