// SPDX-License-Identifier: GPL-3.0-or-later

package expo.modules.runkeepalive

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps a run alive in the background. React Native stops every JS timer once
 * the activity pauses unless a headless task is running, so besides the
 * foreground service we hold one open headless task for the whole run.
 */
class RunKeepAliveModule : Module() {
  private var timerTaskId: Int? = null

  override fun definition() = ModuleDefinition {
    Name("RunKeepAlive")

    Function("start") { title: String, body: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        RunKeepAliveService.start(context, title, body)
      } catch (error: Exception) {
        Log.w(TAG, "Could not start the run service", error)
      }
      UiThreadUtil.runOnUiThread { holdTimers() }
      true
    }

    Function("stop") {
      appContext.reactContext?.let { RunKeepAliveService.stop(it) }
      UiThreadUtil.runOnUiThread { releaseTimers() }
    }

    OnDestroy {
      appContext.reactContext?.let { RunKeepAliveService.stop(it) }
    }
  }

  private fun holdTimers() {
    if (timerTaskId != null) return
    val reactContext = appContext.reactContext as? ReactContext ?: return
    if (!reactContext.hasActiveReactInstance()) return
    timerTaskId = try {
      HeadlessJsTaskContext.getInstance(reactContext)
        .startTask(HeadlessJsTaskConfig(TASK_KEY, Arguments.createMap(), 0, true))
    } catch (error: Exception) {
      Log.w(TAG, "Could not hold JS timers", error)
      null
    }
  }

  private fun releaseTimers() {
    val id = timerTaskId ?: return
    timerTaskId = null
    val reactContext = appContext.reactContext as? ReactContext ?: return
    HeadlessJsTaskContext.getInstance(reactContext).finishTask(id)
  }

  companion object {
    private const val TAG = "RunKeepAlive"
    const val TASK_KEY = "BaseMileRunKeepAlive"
  }
}
