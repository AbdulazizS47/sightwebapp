package sight.printbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PrintService : Service() {
  private val scope = CoroutineScope(Dispatchers.IO)
  private var job: Job? = null
  private val printer = PrinterManager()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startForeground(1, buildNotification("Starting print service"))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (job?.isActive == true) return START_STICKY

    job = scope.launch {
      val prefs = getSharedPreferences("print_bridge", MODE_PRIVATE)
      val serverUrl = prefs.getString("serverUrl", "") ?: ""
      val deviceKey = prefs.getString("deviceKey", "") ?: ""
      val printerAddress = prefs.getString("printerAddress", "") ?: ""

      if (serverUrl.isBlank() || deviceKey.isBlank() || printerAddress.isBlank()) {
        updateNotification("Missing config")
        stopSelf()
        return@launch
      }
      if (!hasBluetoothPermissions()) {
        updateNotification("Bluetooth permission required")
        stopSelf()
        return@launch
      }

      val client = PrintClient(serverUrl, deviceKey)
      val renderer = ReceiptRenderer(this@PrintService)
      val logo = loadLogo(this@PrintService)

      updateNotification("Polling")

      while (true) {
        try {
          val job = client.claimJob()
          if (job != null) {
            updateNotification("Printing ${job.order.orderNumber}")
            try {
              ensureConnected(printerAddress)
              val bitmap = renderer.render(job.order, logo)
              if (!bitmapHasInk(bitmap)) {
                throw IllegalStateException("Rendered bitmap is blank")
              }
              updateNotification(
                "Printing ${job.order.orderNumber} (${bitmap.width}x${bitmap.height})"
              )
              withContext(Dispatchers.IO) {
                printer.write(EscPos.init())
                printer.write(EscPos.feed(1))
                printer.write(EscPos.bitmap24(bitmap))
                printer.write(EscPos.feed(3))
              }
              client.ack(job.id)
              updateNotification("Printed ${job.order.orderNumber}")
            } catch (e: Exception) {
              client.fail(job.id, e.message ?: "Print failed")
              updateNotification("Print failed")
            }
          }
        } catch (e: Exception) {
          updateNotification("Error: ${e.message}")
        }

        delay(4000)
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    job?.cancel()
    printer.disconnect()
  }

  private fun ensureConnected(address: String) {
    if (printer.isConnected()) return
    val adapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter()
    val device = adapter?.bondedDevices?.firstOrNull { it.address == address }
      ?: throw IllegalStateException("Printer not paired")
    printer.connect(device)
  }

  private fun buildNotification(text: String): Notification {
    val channelId = "print_bridge"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(channelId, "Print Bridge", NotificationManager.IMPORTANCE_LOW)
      manager.createNotificationChannel(channel)
    }

    return Notification.Builder(this, channelId)
      .setContentTitle("Print Bridge")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .build()
  }

  private fun updateNotification(text: String) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(1, buildNotification(text))
  }

  private fun bitmapHasInk(bitmap: android.graphics.Bitmap): Boolean {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return false
    for (y in 0 until height) {
      for (x in 0 until width) {
        val pixel = bitmap.getPixel(x, y)
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        val gray = (r * 0.3 + g * 0.59 + b * 0.11).toInt()
        if (gray < 230) return true
      }
    }
    return false
  }

  private fun hasBluetoothPermissions(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
      checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
  }
}

private fun loadLogo(context: Context): android.graphics.Bitmap? {
  return try {
    val names = listOf("receipt.logo.png", "logo.png")
    var bitmap: android.graphics.Bitmap? = null
    for (name in names) {
      try {
        context.assets.open(name).use { bitmap = android.graphics.BitmapFactory.decodeStream(it) }
        if (bitmap != null) break
      } catch (_: Exception) {
        // try next name
      }
    }
    bitmap
  } catch (_: Exception) {
    null
  }
}
