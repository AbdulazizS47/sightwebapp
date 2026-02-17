package sight.printbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class PrintService : Service() {
  private val logTag = "PrintBridge"
  private val scope = CoroutineScope(Dispatchers.IO)
  private var job: Job? = null
  private val printer = PrinterManager()
  private val prefs by lazy { getSharedPreferences(StatusKeys.PREFS, MODE_PRIVATE) }
  private var errorStreak = 0
  private val fixedServerUrl = "https://api.sightcoffeespace.com"
  private val fixedDeviceKey = "1234"

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    setServiceStatus("Starting")
    startForeground(1, buildNotification("Starting print service"))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (job?.isActive == true) return START_STICKY

    job = scope.launch {
      val serverUrl = fixedServerUrl
      val deviceKey = fixedDeviceKey
      val printerAddress = prefs.getString("printerAddress", "") ?: ""

      if (serverUrl.isBlank() || deviceKey.isBlank() || printerAddress.isBlank()) {
        updateNotification("Missing config")
        setServiceStatus("Config missing")
        stopSelf()
        return@launch
      }
      val normalized = normalizeServerUrl(serverUrl)
      if (normalized == null) {
        updateNotification("Invalid server URL")
        setServerStatus("Invalid URL")
        setServiceStatus("Stopped")
        stopSelf()
        return@launch
      }
      if (normalized.startsWith("http://") && !isLocalHost(normalized)) {
        updateNotification("Use https for public domains")
        setServerStatus("Use https for public domains")
        setServiceStatus("Stopped")
        stopSelf()
        return@launch
      }
      if (!hasBluetoothPermissions()) {
        updateNotification("Bluetooth permission required")
        setPrinterStatus("Bluetooth permission required")
        setServiceStatus("Stopped")
        stopSelf()
        return@launch
      }

      val client = PrintClient(normalized, deviceKey)
      val renderer = ReceiptRenderer(this@PrintService)
      val logo = loadLogo(this@PrintService)

      try {
        updateNotification("Checking server...")
        setServerStatus("Checking...")
        client.ping()
        client.pingDeviceKey()
        setServerStatus("OK")
      } catch (e: Exception) {
        logError("Server check failed", e)
        updateNotification(errorMessage(e))
        setServerStatus("Error")
        setError(errorMessage(e))
        setServiceStatus("Stopped")
        stopSelf()
        return@launch
      }

      updateNotification("Polling")
      setServiceStatus("Running")
      setPrinterStatus("Ready")

      while (true) {
        var delayMs = 4000L
        try {
          val job = client.claimJob()
          errorStreak = 0
          if (job != null) {
            setServerStatus("Job claimed")
            setLastOrder(job.order.orderNumber)
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
                printBitmapSafe(bitmap, printerAddress)
              }
              ackWithRetry(client, job.id)
              setPrinterStatus("Printed ${job.order.orderNumber}")
              setLastOrder(job.order.orderNumber)
              updateNotification("Printed ${job.order.orderNumber}")
            } catch (e: Exception) {
              logError("Print failed for job ${job.id}", e)
              try {
                client.fail(job.id, e.message ?: "Print failed", true)
              } catch (failError: Exception) {
                logError("Fail report failed for job ${job.id}", failError)
              }
              setPrinterStatus("Print failed")
              setError(shortMessage(e))
              updateNotification("Print failed: ${shortMessage(e)}")
            }
          } else {
            setServerStatus("No jobs")
          }
        } catch (e: Exception) {
          logError("Polling error", e)
          updateNotification(errorMessage(e))
          setServerStatus("Polling error")
          setError(errorMessage(e))
          errorStreak += 1
          delayMs = (4000L * (errorStreak + 1)).coerceAtMost(30000L)
        }

        delay(delayMs)
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    job?.cancel()
    printer.disconnect()
    setServiceStatus("Stopped")
  }

  private fun ensureConnected(address: String) {
    if (printer.isConnected()) return
    val adapter = android.bluetooth.BluetoothAdapter.getDefaultAdapter()
    val device = adapter?.bondedDevices?.firstOrNull { it.address == address }
      ?: throw IllegalStateException("Printer not paired")
    printer.connect(device)
    setPrinterStatus("Connected: ${device.name}")
  }

  private fun printBitmapSafe(bitmap: Bitmap, printerAddress: String) {
    try {
      printBitmapChunked(bitmap)
    } catch (e: Exception) {
      if (isPipeBroken(e)) {
        logError("Pipe broken, reconnecting printer", e)
        printer.disconnect()
        try {
          Thread.sleep(300)
        } catch (_: InterruptedException) {
        }
        ensureConnected(printerAddress)
        printBitmapChunked(bitmap)
      } else {
        throw e
      }
    }
  }

  private fun printBitmapChunked(bitmap: Bitmap, maxHeight: Int = 240) {
    printer.write(EscPos.init())
    try {
      for (command in EscPos.buzzerSequence()) {
        printer.write(command)
      }
    } catch (_: Exception) {
      // Some printers ignore beep command; proceed with printing.
    }
    printer.write(EscPos.feed(1))
    val width = bitmap.width
    val height = bitmap.height
    var y = 0
    while (y < height) {
      val sliceHeight = minOf(maxHeight, height - y)
      val slice = Bitmap.createBitmap(bitmap, 0, y, width, sliceHeight)
      try {
        printer.write(EscPos.bitmap24(slice))
        printer.write(EscPos.feed(1))
      } finally {
        slice.recycle()
      }
      y += sliceHeight
    }
    printer.write(EscPos.feed(2))
  }

  private fun isPipeBroken(e: Exception): Boolean {
    val msg = e.message?.lowercase() ?: ""
    return msg.contains("broken pipe") ||
      msg.contains("stream closed") ||
      msg.contains("socket") ||
      msg.contains("connection reset")
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

  private fun errorMessage(e: Exception): String {
    val base = when (e) {
      is UnknownHostException -> "DNS error: can't resolve host"
      is SSLHandshakeException -> "TLS error: check HTTPS"
      is ApiException -> {
        val code = e.code?.toString() ?: "HTTP error"
        val body = e.body?.let { truncate(it, 120) }
        val url = e.url?.let { " @ ${truncate(it, 80)}" } ?: ""
        if (body.isNullOrBlank()) "$code$url" else "$code$url: $body"
      }
      else -> e.message ?: "Unknown error"
    }
    return "Error: ${truncate(base, 160)}"
  }

  private fun shortMessage(e: Exception): String {
    val msg = e.message ?: e.javaClass.simpleName
    return truncate(msg, 80)
  }

  private fun logError(context: String, e: Exception) {
    Log.e(logTag, "$context: ${e.message}", e)
  }

  private fun truncate(value: String, max: Int): String {
    if (value.length <= max) return value
    return value.take(max) + "..."
  }

  private fun setServerStatus(text: String) {
    prefs.edit().putString(StatusKeys.SERVER_STATUS, text).apply()
  }

  private fun setPrinterStatus(text: String) {
    prefs.edit().putString(StatusKeys.PRINTER_STATUS, text).apply()
  }

  private fun setServiceStatus(text: String) {
    prefs.edit().putString(StatusKeys.SERVICE_STATUS, text).apply()
  }

  private fun setLastOrder(orderNumber: String) {
    prefs.edit()
      .putString(StatusKeys.LAST_ORDER, orderNumber)
      .putLong(StatusKeys.LAST_ORDER_AT, System.currentTimeMillis())
      .apply()
  }

  private fun setError(text: String) {
    prefs.edit()
      .putString(StatusKeys.LAST_ERROR, text)
      .putLong(StatusKeys.LAST_ERROR_AT, System.currentTimeMillis())
      .apply()
  }

  private suspend fun ackWithRetry(client: PrintClient, jobId: Long) {
    var attempt = 0
    var lastError: Exception? = null
    while (attempt < 3) {
      try {
        client.ack(jobId)
        return
      } catch (e: Exception) {
        lastError = e
        attempt += 1
        delay(1000L * attempt)
      }
    }
    if (lastError != null) {
      logError("Ack failed for job $jobId", lastError)
      setServerStatus("Ack failed")
      setError(lastError.message ?: "Ack failed")
    }
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

  private fun normalizeServerUrl(input: String): String? {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return null
    val candidate = if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      trimmed
    } else {
      "https://$trimmed"
    }
    val url = candidate.toHttpUrlOrNull() ?: return null
    return url.newBuilder().build().toString().trimEnd('/')
  }

  private fun isLocalHost(url: String): Boolean {
    val host = url.toHttpUrlOrNull()?.host ?: return false
    if (host == "localhost") return true
    if (host.startsWith("127.")) return true
    if (host.startsWith("10.")) return true
    if (host.startsWith("192.168.")) return true
    if (host.startsWith("172.")) {
      val parts = host.split(".")
      val second = parts.getOrNull(1)?.toIntOrNull() ?: return false
      return second in 16..31
    }
    return false
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
