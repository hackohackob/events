package com.academyfirstaid.extrememedics.car.screens

import androidx.car.app.CarContext
import androidx.car.app.constraints.ConstraintManager

/**
 * Android Auto refuses a list longer than the host allows while driving, and
 * the limit differs between head units. Ask the host rather than guessing;
 * the fallback matches the platform minimum.
 */
internal fun CarContext.listRowLimit(): Int = try {
  getCarService(ConstraintManager::class.java)
    .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST)
    .coerceAtLeast(1)
} catch (error: Exception) {
  6
}
