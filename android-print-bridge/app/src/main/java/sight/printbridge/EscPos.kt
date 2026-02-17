package sight.printbridge

import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import kotlin.math.min

object EscPos {
  private const val ESC: Byte = 0x1B
  private const val GS: Byte = 0x1D

  fun init(): ByteArray = byteArrayOf(
    ESC, 0x40, // Initialize
    ESC, 0x74, 0x00, // Code page CP437
    ESC, 0x4D, 0x00, // Font A (12x24)
    ESC, 0x61, 0x00, // Align left
    ESC, 0x45, 0x00, // Bold off
  )

  fun feed(lines: Int): ByteArray = byteArrayOf(ESC, 0x64, lines.toByte())

  fun cut(): ByteArray = byteArrayOf(GS, 0x56, 0x00)

  // ESC B n t (beep) - n: 1-9 times, t: 1-9 duration units
  fun buzzer(times: Int = 2, duration: Int = 2): ByteArray {
    val n = times.coerceIn(1, 9)
    val t = duration.coerceIn(1, 9)
    return byteArrayOf(ESC, 0x42, n.toByte(), t.toByte())
  }

  fun text(text: String): ByteArray {
    // Many printers expect CRLF line endings
    val normalized = text.replace("\n", "\r\n")
    return normalized.toByteArray(Charsets.US_ASCII)
  }

  fun bitmap(bitmap: Bitmap): ByteArray {
    val width = bitmap.width
    val height = bitmap.height
    val bytesPerRow = (width + 7) / 8
    val data = ByteArray(bytesPerRow * height)

    var index = 0
    for (y in 0 until height) {
      for (x in 0 until width) {
        val pixel = bitmap.getPixel(x, y)
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        val gray = (r * 0.3 + g * 0.59 + b * 0.11).toInt()
        val bit = if (gray < 160) 1 else 0
        if (bit == 1) {
          val byteIndex = index / 8
          val bitIndex = 7 - (index % 8)
          data[byteIndex] = (data[byteIndex].toInt() or (1 shl bitIndex)).toByte()
        }
        index += 1
      }
      // pad to byte boundary
      index = (index + 7) / 8 * 8
    }

    val xL = (bytesPerRow and 0xFF).toByte()
    val xH = ((bytesPerRow shr 8) and 0xFF).toByte()
    val yL = (height and 0xFF).toByte()
    val yH = ((height shr 8) and 0xFF).toByte()

    val header = byteArrayOf(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH)
    return header + data
  }

  fun bitmapChunks(bitmap: Bitmap, maxHeight: Int = 200): List<ByteArray> {
    val height = bitmap.height
    if (height <= maxHeight) return listOf(bitmap(bitmap))
    val chunks = mutableListOf<ByteArray>()
    var y = 0
    while (y < height) {
      val sliceHeight = min(maxHeight, height - y)
      chunks.add(bitmapSlice(bitmap, y, sliceHeight))
      y += sliceHeight
    }
    return chunks
  }

  private fun bitmapSlice(bitmap: Bitmap, yStart: Int, sliceHeight: Int): ByteArray {
    val width = bitmap.width
    val bytesPerRow = (width + 7) / 8
    val data = ByteArray(bytesPerRow * sliceHeight)

    var index = 0
    for (y in yStart until (yStart + sliceHeight)) {
      for (x in 0 until width) {
        val pixel = bitmap.getPixel(x, y)
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        val gray = (r * 0.3 + g * 0.59 + b * 0.11).toInt()
        val bit = if (gray < 160) 1 else 0
        if (bit == 1) {
          val byteIndex = index / 8
          val bitIndex = 7 - (index % 8)
          data[byteIndex] = (data[byteIndex].toInt() or (1 shl bitIndex)).toByte()
        }
        index += 1
      }
      index = (index + 7) / 8 * 8
    }

    val xL = (bytesPerRow and 0xFF).toByte()
    val xH = ((bytesPerRow shr 8) and 0xFF).toByte()
    val yL = (sliceHeight and 0xFF).toByte()
    val yH = ((sliceHeight shr 8) and 0xFF).toByte()

    val header = byteArrayOf(GS, 0x76, 0x30, 0x00, xL, xH, yL, yH)
    return header + data
  }

  // 24-dot double density (ESC * 33) - widely supported
  fun bitmap24(bitmap: Bitmap): ByteArray {
    val out = ByteArrayOutputStream()
    // Set line spacing to 0
    out.write(byteArrayOf(ESC, 0x33, 0x00))

    val width = bitmap.width
    val height = bitmap.height

    var y = 0
    while (y < height) {
      // ESC * m nL nH
      out.write(
        byteArrayOf(
          ESC,
          0x2A,
          33,
          (width and 0xFF).toByte(),
          ((width shr 8) and 0xFF).toByte()
        )
      )
      for (x in 0 until width) {
        for (bitGroup in 0 until 3) {
          var slice = 0
          for (bit in 0 until 8) {
            val yPos = y + (bitGroup * 8) + bit
            if (x >= width || yPos >= height) continue
            val pixel = bitmap.getPixel(x, yPos)
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8) and 0xFF
            val b = pixel and 0xFF
            val gray = (r * 0.3 + g * 0.59 + b * 0.11).toInt()
            if (gray < 160) {
              slice = slice or (1 shl (7 - bit))
            }
          }
          out.write(slice)
        }
      }
      // line feed
      out.write(0x0A)
      y += 24
    }

    // Restore default line spacing
    out.write(byteArrayOf(ESC, 0x32))
    return out.toByteArray()
  }
}
