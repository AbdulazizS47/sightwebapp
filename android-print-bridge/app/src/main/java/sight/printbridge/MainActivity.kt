package sight.printbridge

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.media.RingtoneManager
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import sight.printbridge.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
  private companion object {
    const val REQUEST_BLUETOOTH_PERMISSIONS = 100
    const val REQUEST_NOTIFICATION_PERMISSION = 101
  }

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
  private val receiptWidthOptions = listOf(
    StatusKeys.RECEIPT_WIDTH_80MM to R.string.receipt_size_80,
    StatusKeys.RECEIPT_WIDTH_58MM to R.string.receipt_size_58,
  )
  private lateinit var queueAdapter: OrderQueueAdapter
  private var lastQueueJson: String? = null
  private val availableDevices = mutableListOf<BluetoothDevice>()
  private var isDiscoveryReceiverRegistered = false
  private var isDiscoveryRunning = false

  private val prefs by lazy { getSharedPreferences(StatusKeys.PREFS, MODE_PRIVATE) }
  private val discoveryReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: android.content.Context?, intent: Intent?) {
      when (intent?.action) {
        BluetoothAdapter.ACTION_DISCOVERY_STARTED -> {
          isDiscoveryRunning = true
          setPrinterStatus("Searching printers...")
        }
        BluetoothDevice.ACTION_FOUND -> {
          val device = extractBluetoothDevice(intent) ?: return
          addOrUpdateDevice(device)
          renderDeviceSpinner()
          setPrinterStatus("Searching printers... (${availableDevices.size})")
        }
        BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
          isDiscoveryRunning = false
          if (availableDevices.isEmpty()) {
            setPrinterStatus("No printers found")
            setError("No paired/found printers. Pair printer in tablet Bluetooth settings, then tap Search Printers.")
          } else {
            setPrinterStatus("Ready (${availableDevices.size} found)")
          }
        }
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)

    binding.serverUrl.setText(prefs.getString("serverUrl", "") ?: "")
    binding.deviceKey.visibility = View.GONE
    binding.deviceKey.setText("Built-in")
    setServiceStatus("Idle")
    setServerStatus(prefs.getString(StatusKeys.SERVER_STATUS, "-") ?: "-")
    setPrinterStatus(prefs.getString(StatusKeys.PRINTER_STATUS, "-") ?: "-")
    setLastOrderText(prefs.getString(StatusKeys.LAST_ORDER, "-") ?: "-")
    setErrorText(prefs.getString(StatusKeys.LAST_ERROR, "-") ?: "-")

    queueAdapter = OrderQueueAdapter { item ->
      val updated = OrderQueue.remove(prefs, item.id)
      updateQueue(updated)
    }
    binding.queueList.layoutManager = LinearLayoutManager(this)
    binding.queueList.adapter = queueAdapter
    updateQueue(OrderQueue.load(prefs))

    migrateReceiptProfileIfNeeded()
    registerDiscoveryReceiverIfNeeded()
    ensureRuntimePermissions()
    setupReceiptSizeSelector()
    if (hasBluetoothPermissions()) {
      loadKnownPrinters()
      startPrinterDiscovery()
    } else {
      setPrinterStatus("Bluetooth permission required")
      setError("Allow Nearby devices permission, then tap Search Printers.")
    }

    binding.refreshPrintersButton.setOnClickListener {
      if (!hasBluetoothPermissions()) {
        ensureRuntimePermissions()
        setPrinterStatus("Bluetooth permission required")
        return@setOnClickListener
      }
      loadKnownPrinters()
      startPrinterDiscovery()
    }

    binding.connectButton.setOnClickListener {
      if (printer.isConnected()) disconnectPrinter() else connectPrinter()
    }

    binding.startButton.setOnClickListener {
      val serverInput = binding.serverUrl.text?.toString().orEmpty()
      val deviceKey = PrintBridgeConfig.fixedDeviceKey
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
      if (!PrintBridgeConfig.hasValidFixedDeviceKey()) {
        setError("Built-in device key is invalid (${deviceKey.length}/16). Update the app build config.")
        setServerStatus("Invalid built-in key")
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
          val receiptWidthPx = selectedReceiptWidthPx()
          prefs.edit().putString("serverUrl", normalized).remove("deviceKey").apply()
          prefs.edit().putString("printerAddress", device.address).apply()
          prefs.edit().putInt(StatusKeys.RECEIPT_WIDTH_PX, receiptWidthPx).apply()
          setServerStatus("OK")
          setServiceStatus("Running")
          ContextCompat.startForegroundService(
            this@MainActivity,
            Intent(this@MainActivity, PrintService::class.java),
          )
        } catch (e: Exception) {
          setServerStatus("Error")
          setError(errorMessage(e))
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
          val receiptWidthPx = selectedReceiptWidthPx()
          prefs.edit().putInt(StatusKeys.RECEIPT_WIDTH_PX, receiptWidthPx).apply()
          val renderer = ReceiptRenderer(this@MainActivity, targetWidthPx = receiptWidthPx)
          val bitmap = renderer.render(diagnosticOrder(), loadLogo())
          printBitmap(bitmap)
          playNotificationSound()
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
    stopPrinterDiscovery()
  }

  override fun onDestroy() {
    super.onDestroy()
    stopPrinterDiscovery()
    unregisterDiscoveryReceiverIfNeeded()
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    when (requestCode) {
      REQUEST_BLUETOOTH_PERMISSIONS -> {
        val allGranted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (allGranted) {
          loadKnownPrinters()
          startPrinterDiscovery()
        } else {
          setError("Bluetooth permission required")
          setPrinterStatus("Bluetooth permission required")
        }
      }
      REQUEST_NOTIFICATION_PERMISSION -> {
        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (!granted) {
          setError("Notification permission denied. Printing still works.")
        }
      }
    }
  }

  private fun ensureRuntimePermissions() {
    val bluetoothNeeded = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
        bluetoothNeeded.add(Manifest.permission.BLUETOOTH_CONNECT)
      }
      if (!hasPermission(Manifest.permission.BLUETOOTH_SCAN)) {
        bluetoothNeeded.add(Manifest.permission.BLUETOOTH_SCAN)
      }
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
        bluetoothNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION)
      }
    }
    if (bluetoothNeeded.isNotEmpty()) {
      ActivityCompat.requestPermissions(
        this,
        bluetoothNeeded.toTypedArray(),
        REQUEST_BLUETOOTH_PERMISSIONS,
      )
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (!hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          REQUEST_NOTIFICATION_PERMISSION,
        )
      }
    }
  }

  private fun loadKnownPrinters() {
    if (!hasBluetoothPermissions()) {
      setError("Bluetooth permission required")
      return
    }
    val btAdapter = adapter
    if (btAdapter == null) {
      setError("Bluetooth is not supported on this tablet")
      setPrinterStatus("Bluetooth unavailable")
      return
    }
    if (!btAdapter.isEnabled) {
      setError("Bluetooth is turned off")
      setPrinterStatus("Enable Bluetooth and tap Search Printers")
      return
    }

    availableDevices.clear()
    btAdapter.bondedDevices?.forEach { addOrUpdateDevice(it) }
    renderDeviceSpinner()

    if (availableDevices.isNotEmpty()) {
      setPrinterStatus("Ready (${availableDevices.size} paired)")
    } else {
      setPrinterStatus("No paired printers")
    }
  }

  private fun startPrinterDiscovery() {
    if (!hasBluetoothPermissions()) {
      ensureRuntimePermissions()
      setError("Bluetooth permission required")
      return
    }
    val btAdapter = adapter
    if (btAdapter == null) {
      setError("Bluetooth is not supported on this tablet")
      setPrinterStatus("Bluetooth unavailable")
      return
    }
    if (!btAdapter.isEnabled) {
      setError("Bluetooth is turned off")
      setPrinterStatus("Enable Bluetooth and tap Search Printers")
      return
    }

    try {
      if (btAdapter.isDiscovering) {
        btAdapter.cancelDiscovery()
      }
      if (btAdapter.startDiscovery()) {
        isDiscoveryRunning = true
        setPrinterStatus("Searching printers...")
      } else if (availableDevices.isEmpty()) {
        setPrinterStatus("No printers found")
      }
    } catch (_: SecurityException) {
      setError("Bluetooth permission required")
      setPrinterStatus("Bluetooth permission required")
      ensureRuntimePermissions()
    }
  }

  private fun stopPrinterDiscovery() {
    if (!isDiscoveryRunning) return
    try {
      adapter?.cancelDiscovery()
    } catch (_: SecurityException) {
    }
    isDiscoveryRunning = false
  }

  private fun registerDiscoveryReceiverIfNeeded() {
    if (isDiscoveryReceiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED)
      addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
      addAction(BluetoothDevice.ACTION_FOUND)
    }
    ContextCompat.registerReceiver(
      this,
      discoveryReceiver,
      filter,
      ContextCompat.RECEIVER_EXPORTED,
    )
    isDiscoveryReceiverRegistered = true
  }

  private fun unregisterDiscoveryReceiverIfNeeded() {
    if (!isDiscoveryReceiverRegistered) return
    try {
      unregisterReceiver(discoveryReceiver)
    } catch (_: Exception) {
    }
    isDiscoveryReceiverRegistered = false
  }

  private fun addOrUpdateDevice(device: BluetoothDevice) {
    val index = availableDevices.indexOfFirst { it.address == device.address }
    if (index >= 0) {
      availableDevices[index] = device
    } else {
      availableDevices.add(device)
    }
  }

  private fun renderDeviceSpinner() {
    val names = availableDevices.map { "${it.name ?: "Device"} (${it.address})" }
    binding.printerSpinner.adapter = android.widget.ArrayAdapter(
      this,
      android.R.layout.simple_spinner_dropdown_item,
      names,
    )
    val savedAddress = prefs.getString("printerAddress", null)
    if (savedAddress != null) {
      val index = availableDevices.indexOfFirst { it.address == savedAddress }
      if (index >= 0) {
        binding.printerSpinner.setSelection(index)
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun extractBluetoothDevice(intent: Intent): BluetoothDevice? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
    } else {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }
  }

  private fun setupReceiptSizeSelector() {
    val labels = receiptWidthOptions.map { (_, labelRes) -> getString(labelRes) }
    val spinner = binding.receiptSizeSpinner
    spinner.adapter = android.widget.ArrayAdapter(
      this,
      android.R.layout.simple_spinner_dropdown_item,
      labels
    )
    val savedWidth = prefs.getInt(
      StatusKeys.RECEIPT_WIDTH_PX,
      StatusKeys.DEFAULT_RECEIPT_WIDTH_PX
    )
    val selectedIndex = receiptWidthOptions.indexOfFirst { (width, _) -> width == savedWidth }
    spinner.setSelection(if (selectedIndex >= 0) selectedIndex else 0)
  }

  private fun migrateReceiptProfileIfNeeded() {
    val version = prefs.getInt(StatusKeys.RECEIPT_LAYOUT_VERSION, 0)
    if (version >= StatusKeys.RECEIPT_LAYOUT_VERSION_CURRENT) return

    val savedWidth = prefs.getInt(StatusKeys.RECEIPT_WIDTH_PX, StatusKeys.RECEIPT_WIDTH_58MM)
    val upgradedWidth = when (savedWidth) {
      StatusKeys.RECEIPT_WIDTH_58MM -> StatusKeys.RECEIPT_WIDTH_80MM
      StatusKeys.RECEIPT_WIDTH_80MM -> StatusKeys.RECEIPT_WIDTH_80MM
      else -> StatusKeys.DEFAULT_RECEIPT_WIDTH_PX
    }

    prefs.edit()
      .putInt(StatusKeys.RECEIPT_WIDTH_PX, upgradedWidth)
      .putInt(StatusKeys.RECEIPT_LAYOUT_VERSION, StatusKeys.RECEIPT_LAYOUT_VERSION_CURRENT)
      .apply()
  }

  private fun selectedDevice(): BluetoothDevice? {
    if (!hasBluetoothPermissions()) return null
    val idx = binding.printerSpinner.selectedItemPosition
    return availableDevices.getOrNull(idx)
  }

  private fun selectedReceiptWidthPx(): Int {
    val idx = binding.receiptSizeSpinner.selectedItemPosition
    return receiptWidthOptions.getOrNull(idx)?.first ?: StatusKeys.DEFAULT_RECEIPT_WIDTH_PX
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
      printer.write(EscPos.bitmap24(bitmap))
      printer.write(EscPos.feed(8))
      try {
        Thread.sleep(180)
      } catch (_: InterruptedException) {
      }
      try {
        printer.write(EscPos.cut())
      } catch (_: Exception) {
        // Not all thermal printers support cut command.
      }
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
    val queueJson = prefs.getString(StatusKeys.QUEUE_JSON, "[]") ?: "[]"
    if (queueJson != lastQueueJson) {
      lastQueueJson = queueJson
      updateQueue(OrderQueue.fromJson(queueJson))
    }
  }

  private fun playNotificationSound(durationMs: Long = 3000L) {
    val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return
    val ringtone = RingtoneManager.getRingtone(this, uri) ?: return
    ringtone.play()
    Handler(Looper.getMainLooper()).postDelayed({
      try {
        ringtone.stop()
      } catch (_: Exception) {
      }
    }, durationMs)
  }

  private fun updateQueue(queue: List<QueueOrder>) {
    queueAdapter.setItems(queue)
    binding.queueLabel.text = getString(R.string.orders_queue) + " (${queue.size})"
    if (queue.isEmpty()) {
      binding.queueEmptyText.visibility = View.VISIBLE
      binding.queueList.visibility = View.GONE
    } else {
      binding.queueEmptyText.visibility = View.GONE
      binding.queueList.visibility = View.VISIBLE
    }
  }

  private fun hasBluetoothPermissions(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return hasPermission(Manifest.permission.BLUETOOTH_CONNECT) &&
        hasPermission(Manifest.permission.BLUETOOTH_SCAN)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      return hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }
    return true
  }

  private fun hasPermission(name: String): Boolean {
    return ContextCompat.checkSelfPermission(this, name) == PackageManager.PERMISSION_GRANTED
  }

  private fun diagnosticOrder(): Order {
    return Order(
      id = "order:diagnostic",
      orderNumber = "20260101-001",
      displayNumber = 1,
      createdAt = System.currentTimeMillis(),
      userName = "Printer Test",
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
    val normalizedHost = when {
      url.host == "apl.sightcoffeespace.com" -> "api.sightcoffeespace.com"
      url.host.startsWith("apl.") -> "api." + url.host.removePrefix("apl.")
      else -> url.host
    }
    val cleanPath = when (url.encodedPath.lowercase()) {
      "/api", "/api/", "/apl", "/apl/", "/" -> "/"
      else -> url.encodedPath
    }
    return try {
      url.newBuilder()
        .host(normalizedHost)
        .encodedPath(cleanPath)
        .build()
        .toString()
        .trimEnd('/')
    } catch (_: IllegalArgumentException) {
      null
    }
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
    return "Server check failed: ${truncate(base, 160)}"
  }

  private fun truncate(value: String, max: Int): String {
    if (value.length <= max) return value
    return value.take(max) + "..."
  }
}
