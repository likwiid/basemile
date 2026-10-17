// SPDX-License-Identifier: GPL-3.0-or-later

package expo.modules.runkeepalive

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * Foreground service that keeps the process (and its CPU) alive while a run
 * is in progress, so GPS, heart rate and voice cues carry on with the screen
 * off or another app in front.
 */
class RunKeepAliveService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Run in progress"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    try {
      val notification = buildNotification(title, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, serviceTypes())
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not enter the foreground", error)
      stopSelf()
      return START_NOT_STICKY
    }
    holdWakeLock()
    // Without the JS runtime there is nothing to keep alive, so never restart.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  private fun holdWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BaseMile:run").apply {
      setReferenceCounted(false)
      acquire(WAKE_LOCK_CAP_MS)
    }
  }

  /** Only claim the service types whose runtime permission is granted. */
  private fun serviceTypes(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
    var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    if (granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && granted(Manifest.permission.BLUETOOTH_CONNECT)) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    }
    return types
  }

  private fun granted(permission: String): Boolean =
    checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  private fun buildNotification(title: String, body: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Active run", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while a run is being tracked"
          setShowBadge(false)
        }
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    }
    if (launch != null) {
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      )
    }
    return builder
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(smallIcon())
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_WORKOUT)
      .setOnlyAlertOnce(true)
      .build()
  }

  private fun smallIcon(): Int {
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    return if (icon != 0) icon else applicationInfo.icon
  }

  companion object {
    private const val TAG = "RunKeepAlive"
    private const val CHANNEL_ID = "active-run"
    private const val NOTIFICATION_ID = 4107
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"
    // Safety net: a forgotten lock must not drain the battery for days.
    private const val WAKE_LOCK_CAP_MS = 8L * 60 * 60 * 1000

    fun start(context: Context, title: String, body: String) {
      val intent = Intent(context, RunKeepAliveService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, RunKeepAliveService::class.java))
    }
  }
}
