package sight.printbridge

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import java.io.OutputStream
import java.util.UUID

class PrinterManager {
  private val adapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
  private var socket: BluetoothSocket? = null
  private var output: OutputStream? = null

  fun isConnected(): Boolean = socket?.isConnected == true && output != null

  fun connect(device: BluetoothDevice) {
    val uuid = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")
    try {
      adapter?.cancelDiscovery()
    } catch (_: SecurityException) {
      // Permissions might be missing; proceed and let connect attempt fail if needed.
    }
    val sock = device.createRfcommSocketToServiceRecord(uuid)
    try {
      sock.connect()
      socket = sock
      output = sock.outputStream
      return
    } catch (e: Exception) {
      try {
        sock.close()
      } catch (_: Exception) {
      }
    }

    // Some printers require an insecure RFCOMM socket.
    val insecure = device.createInsecureRfcommSocketToServiceRecord(uuid)
    insecure.connect()
    socket = insecure
    output = insecure.outputStream
  }

  fun disconnect() {
    try {
      output?.close()
    } catch (_: Exception) {
    }
    try {
      socket?.close()
    } catch (_: Exception) {
    }
    output = null
    socket = null
  }

  fun write(bytes: ByteArray) {
    val out = output ?: throw IllegalStateException("Printer not connected")
    out.write(bytes)
    out.flush()
  }
}
