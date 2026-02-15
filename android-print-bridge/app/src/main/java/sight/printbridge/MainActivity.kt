package sight.printbridge

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.pm.PackageManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import sight.printbridge.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
  private lateinit var binding: ActivityMainBinding
  private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
  private val printer = PrinterManager()
  private val ioScope = CoroutineScope(Dispatchers.IO)
  private val statusHandler = Handler(Looper.getMainLooper())
  private val statusRunnable = object : Runnable {
    override fun run() {
      refreshStatusFromPrefs()
      statusHandler.postDelayed(this, 1000)
    }
  }
  private val fixedServerUrl = "https://api.sightcoffeespace.com"
  private val fixedDeviceKey = "1234"

  private val prefs by lazy { getSharedPreferences(StatusKeys.PREFS, MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)

    binding.serverUrl.setText(fixedServerUrl)
    binding.deviceKey.setText(fixedDeviceKey)
    binding.serverUrl.isEnabled = false
    binding.deviceKey.isEnabled = false
    prefs.edit()
      .putString("serverUrl", fixedServerUrl)
      .putString("deviceKey", fixedDeviceKey)
      .apply()
    setServiceStatus("Idle")
    setServerStatus(prefs.getString(StatusKeys.SERVER_STATUS, "-") ?: "-")
    setPrinterStatus(prefs.getString(StatusKeys.PRINTER_STATUS, "-") ?: "-")
    setLastOrderText(prefs.getString(StatusKeys.LAST_ORDER, "-") ?: "-")
    setErrorText(prefs.getString(StatusKeys.LAST_ERROR, "-") ?: "-")

    ensureRuntimePermissions()
    loadPairedPrinters()

    binding.connectButton.setOnClickListener {
      if (printer.isConnected()) disconnectPrinter() else connectPrinter()
    }

    binding.startButton.setOnClickListener {
      val serverInput = fixedServerUrl
      val deviceKey = fixedDeviceKey
      if (!hasBluetoothPermissions()) {
        ensureRuntimePermissions()
        setError("Bluetooth permission required")
        setPrinterStatus("Bluetooth permission required")
        return@setOnClickListener
      }
      val device = selectedDevice()
      if (device == null) {
        setError("Select a printer")
        setPrinterStatus("No printer selected")
        return@setOnClickListener
      }
      val normalized = normalizeServerUrl(serverInput)
      if (normalized == null) {
        setError("Invalid server URL")
        setServerStatus("Invalid URL")
        return@setOnClickListener
      }
      if (normalized.startsWith("http://") && !isLocalHost(normalized)) {
        setError("Use https for public domains")
        setServerStatus("Use https for public domains")
        return@setOnClickListener
      }

      ioScope.launch {
        try {
          setServiceStatus("Starting...")
          setServerStatus("Checking...")
          val client = PrintClient(normalized, deviceKey)
          client.ping()
          client.pingDeviceKey()
          prefs.edit().putString("serverUrl", normalized).putString("deviceKey", deviceKey).apply()
          prefs.edit().putString("printerAddress", device.address).apply()
          setServerStatus("OK")
          setServiceStatus("Running")
          ContextCompat.startForegroundService(
            this@MainActivity,
            Intent(this@MainActivity, PrintService::class.java),
          )
        } catch (e: Exception) {
          setServerStatus("Error")
          setError("Server check failed: ${e.message}")
          setServiceStatus("Stopped")
        }
      }
    }

    binding.testButton.setOnClickListener {
      ioScope.launch {
        try {
          val device = selectedDevice()
          if (device == null) {
            setError("No printer selected")
            setPrinterStatus("No printer selected")
            return@launch
          }
          if (!hasBluetoothPermissions()) {
            ensureRuntimePermissions()
            setError("Bluetooth permission required")
            setPrinterStatus("Bluetooth permission required")
            return@launch
          }
          if (!printer.isConnected()) {
            setPrinterStatus("Connecting...")
            printer.connect(device)
            setPrinterStatus("Connected: ${device.name}")
          }
          prefs.edit().putString("printerAddress", device.address).apply()
          val renderer = ReceiptRenderer(this@MainActivity)
          val bitmap = renderer.render(sampleOrder(), loadLogo())
          printBitmap(bitmap)
          setLastOrderText("Test print")
          setPrinterStatus("Test print sent")
        } catch (e: Exception) {
          setPrinterStatus("Test print failed")
          setError("Test print failed: ${e.message}")
        }
      }
    }
  }

  override fun onStart() {
    super.onStart()
    statusHandler.post(statusRunnable)
  }

  override fun onStop() {
    super.onStop()
    statusHandler.removeCallbacks(statusRunnable)
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 100) {
      val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
      if (allGranted) {
        loadPairedPrinters()
      } else {
        setError("Bluetooth/notification permission required")
      }
    }
  }

  private fun ensureRuntimePermissions() {
    val needed = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
        needed.add(Manifest.permission.BLUETOOTH_CONNECT)
      }
      if (!hasPermission(Manifest.permission.BLUETOOTH_SCAN)) {
        needed.add(Manifest.permission.BLUETOOTH_SCAN)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (!hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
        needed.add(Manifest.permission.POST_NOTIFICATIONS)
      }
    }
    if (needed.isNotEmpty()) {
      ActivityCompat.requestPermissions(this, needed.toTypedArray(), 100)
    }
  }

  private fun loadPairedPrinters() {
    if (!hasBluetoothPermissions()) {
      setError("Bluetooth permission required")
      return
    }
    val devices = adapter?.bondedDevices?.toList() ?: emptyList()
    val names = devices.map { "${it.name ?: "Device"} (${it.address})" }
    val spinner = binding.printerSpinner
    spinner.adapter = android.widget.ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)

    val savedAddress = prefs.getString("printerAddress", null)
    if (savedAddress != null) {
      val index = devices.indexOfFirst { it.address == savedAddress }
      if (index >= 0) spinner.setSelection(index)
    }
    if (devices.isNotEmpty()) {
      setPrinterStatus("Ready")
    }
  }

  private fun selectedDevice(): BluetoothDevice? {
    if (!hasBluetoothPermissions()) return null
    val devices = adapter?.bondedDevices?.toList() ?: return null
    val idx = binding.printerSpinner.selectedItemPosition
    return devices.getOrNull(idx)
  }

  private fun connectPrinter() {
    if (!hasBluetoothPermissions()) {
      ensureRuntimePermissions()
      setError("Bluetooth permission required")
      setPrinterStatus("Bluetooth permission required")
      return
    }
    val device = selectedDevice() ?: return
    prefs.edit().putString("printerAddress", device.address).apply()
    ioScope.launch {
      try {
        printer.connect(device)
        setPrinterStatus("Connected: ${device.name}")
      } catch (e: Exception) {
        setPrinterStatus("Connect failed")
        setError("Connect failed: ${e.message}")
      }
    }
  }

  private fun disconnectPrinter() {
    ioScope.launch {
      printer.disconnect()
      setPrinterStatus("Disconnected")
    }
  }

  private suspend fun printBitmap(bitmap: android.graphics.Bitmap) {
    withContext(Dispatchers.IO) {
      printer.write(EscPos.init())
      printer.write(EscPos.feed(1))
      printer.write(EscPos.bitmap24(bitmap))
      printer.write(EscPos.feed(3))
    }
  }

  private fun setServiceStatus(text: String) {
    prefs.edit().putString(StatusKeys.SERVICE_STATUS, text).apply()
    runOnUiThread { binding.serviceStatusText.text = text }
  }

  private fun setServerStatus(text: String) {
    prefs.edit().putString(StatusKeys.SERVER_STATUS, text).apply()
    runOnUiThread { binding.serverStatusText.text = text }
  }

  private fun setPrinterStatus(text: String) {
    prefs.edit().putString(StatusKeys.PRINTER_STATUS, text).apply()
    runOnUiThread { binding.printerStatusText.text = text }
  }

  private fun setLastOrderText(text: String) {
    prefs.edit().putString(StatusKeys.LAST_ORDER, text).apply()
    runOnUiThread { binding.lastOrderText.text = text }
  }

  private fun setError(text: String) {
    prefs.edit()
      .putString(StatusKeys.LAST_ERROR, text)
      .putLong(StatusKeys.LAST_ERROR_AT, System.currentTimeMillis())
      .apply()
    runOnUiThread { binding.errorText.text = text }
  }

  private fun setErrorText(text: String) {
    runOnUiThread { binding.errorText.text = text }
  }

  private fun refreshStatusFromPrefs() {
    val server = prefs.getString(StatusKeys.SERVER_STATUS, "-") ?: "-"
    val printer = prefs.getString(StatusKeys.PRINTER_STATUS, "-") ?: "-"
    val service = prefs.getString(StatusKeys.SERVICE_STATUS, "-") ?: "-"
    val lastOrder = prefs.getString(StatusKeys.LAST_ORDER, "-") ?: "-"
    val lastError = prefs.getString(StatusKeys.LAST_ERROR, "-") ?: "-"
    binding.serverStatusText.text = server
    binding.printerStatusText.text = printer
    binding.serviceStatusText.text = service
    binding.lastOrderText.text = lastOrder
    binding.errorText.text = lastError
  }

  private fun hasBluetoothConnectPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
  }

  private fun hasBluetoothPermissions(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return hasPermission(Manifest.permission.BLUETOOTH_CONNECT) &&
      hasPermission(Manifest.permission.BLUETOOTH_SCAN)
  }

  private fun hasPermission(name: String): Boolean {
    return ContextCompat.checkSelfPermission(this, name) == PackageManager.PERMISSION_GRANTED
  }

  private fun sampleOrder(): Order {
    return Order(
      id = "order:demo",
      orderNumber = "20260101-001",
      displayNumber = 1,
      createdAt = System.currentTimeMillis(),
      phoneNumber = "9665568222800",
      paymentMethod = "cash",
      status = "received",
      items = listOf(
        OrderItem("Latte / لاتيه", 16.0, 1),
        OrderItem("V60 / في60", 18.0, 1),
      ),
      subtotalExclVat = 29.56,
      vatAmount = 4.44,
      totalWithVat = 34.0,
    )
  }

  private fun loadLogo(): android.graphics.Bitmap? {
    val names = listOf("receipt.logo.png", "logo.png")
    for (name in names) {
      try {
        assets.open(name).use { return android.graphics.BitmapFactory.decodeStream(it) }
      } catch (_: Exception) {
        // try next
      }
    }
    return null
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
