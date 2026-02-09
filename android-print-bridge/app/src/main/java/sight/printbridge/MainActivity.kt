package sight.printbridge

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.pm.PackageManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import sight.printbridge.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
  private lateinit var binding: ActivityMainBinding
  private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
  private val printer = PrinterManager()
  private val ioScope = CoroutineScope(Dispatchers.IO)

  private val prefs by lazy { getSharedPreferences("print_bridge", MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)

    binding.serverUrl.setText(prefs.getString("serverUrl", ""))
    binding.deviceKey.setText(prefs.getString("deviceKey", ""))

    ensureRuntimePermissions()
    loadPairedPrinters()

    binding.connectButton.setOnClickListener {
      if (printer.isConnected()) disconnectPrinter() else connectPrinter()
    }

    binding.startButton.setOnClickListener {
      val serverUrl = binding.serverUrl.text.toString().trim()
      val deviceKey = binding.deviceKey.text.toString().trim()
      if (serverUrl.isEmpty() || deviceKey.isEmpty()) {
        setError("Missing server URL or device key")
        return@setOnClickListener
      }
      if (!hasBluetoothPermissions()) {
        ensureRuntimePermissions()
        setError("Bluetooth permission required")
        return@setOnClickListener
      }
      val device = selectedDevice()
      if (device == null) {
        setError("Select a printer")
        return@setOnClickListener
      }
      prefs.edit().putString("serverUrl", serverUrl).putString("deviceKey", deviceKey).apply()
      prefs.edit().putString("printerAddress", device.address).apply()
      ContextCompat.startForegroundService(this, Intent(this, PrintService::class.java))
    }

    binding.testButton.setOnClickListener {
      ioScope.launch {
        try {
          val device = selectedDevice()
          if (device == null) {
            setError("No printer selected")
            return@launch
          }
          if (!hasBluetoothPermissions()) {
            ensureRuntimePermissions()
            setError("Bluetooth permission required")
            return@launch
          }
          if (!printer.isConnected()) {
            setStatus("Connecting...")
            printer.connect(device)
            setStatus("Connected: ${device.name}")
          }
          prefs.edit().putString("printerAddress", device.address).apply()
          val renderer = ReceiptRenderer(this@MainActivity)
          val bitmap = renderer.render(sampleOrder(), loadLogo())
          printBitmap(bitmap)
          setStatus("Test print sent")
        } catch (e: Exception) {
          setError("Test print failed: ${e.message}")
        }
      }
    }
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
      return
    }
    val device = selectedDevice() ?: return
    prefs.edit().putString("printerAddress", device.address).apply()
    ioScope.launch {
      try {
        printer.connect(device)
        setStatus("Connected: ${device.name}")
      } catch (e: Exception) {
        setError("Connect failed: ${e.message}")
      }
    }
  }

  private fun disconnectPrinter() {
    ioScope.launch {
      printer.disconnect()
      setStatus("Disconnected")
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

  private fun setStatus(text: String) {
    runOnUiThread { binding.statusText.text = "Status: $text" }
  }

  private fun setError(text: String) {
    runOnUiThread { binding.errorText.text = "Last Error: $text" }
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
}
