package sight.printbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.text.TextPaint
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ReceiptRenderer(
  private val context: Context,
  targetWidthPx: Int = StatusKeys.DEFAULT_RECEIPT_WIDTH_PX,
) {
  private val widthPx = targetWidthPx.coerceIn(320, 832)
  private val layoutScale = (
    1f + ((widthPx - StatusKeys.RECEIPT_WIDTH_58MM.toFloat()) / StatusKeys.RECEIPT_WIDTH_58MM) * 0.55f
    ).coerceIn(1f, 1.65f)
  private val margin = (widthPx * 0.035f).coerceIn(scale(14f), scale(34f))

  private fun scale(value: Float): Float = value * layoutScale

  private fun loadArabicTypeface(): Pair<Typeface, Boolean> {
    val typeface = try {
      context.assets.open("fonts/Cairo-Regular.ttf").close()
      Typeface.createFromAsset(context.assets, "fonts/Cairo-Regular.ttf")
    } catch (_: Exception) {
      Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
    }
    val probe = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = 18f
      this.typeface = typeface
    }
    val hasArabic = probe.hasGlyph("س") && probe.hasGlyph("ع")
    return Pair(typeface, hasArabic)
  }

  fun render(order: Order, logo: Bitmap?): Bitmap {
    val (typeface, hasArabic) = loadArabicTypeface()
    val textSmall = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      textSize = scale(20f)
      this.typeface = typeface
    }
    val textMuted = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.DKGRAY
      textSize = scale(18f)
      this.typeface = typeface
    }
    val textLarge = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      textSize = scale(44f)
      this.typeface = Typeface.create(typeface, Typeface.BOLD)
    }
    val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      strokeWidth = scale(2f).coerceIn(2f, 4f)
    }
    val framePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      style = Paint.Style.STROKE
      strokeWidth = scale(2f).coerceIn(2f, 4f)
    }

    val orderLabel = if (hasArabic) "Order Number / رقم الطلب" else "Order Number"
    val itemsLabel = if (hasArabic) "Items / العناصر" else "Items"
    val dateLabel = if (hasArabic) "Date / التاريخ" else "Date"
    val timeLabel = if (hasArabic) "Time / الوقت" else "Time"
    val subtotalLabel = if (hasArabic) "Subtotal / المجموع" else "Subtotal"
    val vatLabel = if (hasArabic) "VAT (15%) / ضريبة" else "VAT (15%)"
    val totalLabel = if (hasArabic) "Total / الإجمالي" else "Total"
    val footerLabel =
      if (hasArabic) "share with us @sightcafee شاركنا رايك على" else "Share with us @sightcafee"

    val height = measureHeight(order, logo, textSmall, textMuted, hasArabic, footerLabel)
    val bitmap = Bitmap.createBitmap(widthPx, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.WHITE)

    val sectionGap = scale(16f)
    val rowGap = scale(10f)
    var y = 0f
    if (logo != null) {
      val logoWidth = (widthPx * 0.58f).toInt()
      val logoHeight = (logoWidth.toFloat() / logo.width * logo.height).toInt()
      val scaled = Bitmap.createScaledBitmap(logo, logoWidth, logoHeight, true)
      val x = (widthPx - logoWidth) / 2f
      canvas.drawBitmap(scaled, x, y, null)
      y += logoHeight + sectionGap
    }

    // Order number block
    val orderLabelGap = scale(10f)
    val orderTopPadding = scale(12f)
    val orderBottomPadding = scale(14f)
    val blockHeight = orderTopPadding + textMuted.textSize + orderLabelGap + textLarge.textSize + orderBottomPadding
    canvas.drawRect(margin, y, widthPx - margin, y + blockHeight, framePaint)
    val orderLabelY = y + orderTopPadding + textMuted.textSize
    drawCenteredText(canvas, orderLabel, textMuted, orderLabelY)
    val display = "#${order.displayNumber}"
    drawCenteredText(canvas, toEnglishDigits(display), textLarge, orderLabelY + orderLabelGap + textLarge.textSize)
    y += blockHeight + sectionGap

    // Date and time row
    val dateTime = formatDateTime(order.createdAt)
    drawLabelValue(
      canvas,
      dateLabel,
      dateTime.first,
      margin,
      y,
      textMuted,
      textSmall,
      alignRight = false
    )
    drawLabelValue(
      canvas,
      timeLabel,
      dateTime.second,
      widthPx - margin,
      y,
      textMuted,
      textSmall,
      alignRight = true
    )
    y += textSmall.textSize + textMuted.textSize + rowGap
    canvas.drawLine(margin, y, widthPx - margin, y, linePaint)
    y += rowGap

    // Items header
    canvas.drawText(itemsLabel, margin, y + textMuted.textSize, textMuted)
    y += textMuted.textSize + scale(8f)

    // Items list
    order.items.forEach { item ->
      val name = resolveItemName(item, hasArabic)
      val qtyName = "${item.quantity}x ${name}"
      val price = "${formatMoney(item.price * item.quantity)} SAR"
      y = drawItemRow(canvas, qtyName, price, y, textSmall, rowGap = scale(6f))
    }

    y += scale(8f)
    canvas.drawLine(margin, y, widthPx - margin, y, linePaint)
    y += rowGap

    // Totals
    y = drawTotalRow(canvas, subtotalLabel, order.subtotalExclVat, y, textSmall, rowGap = scale(9f), bold = false)
    y = drawTotalRow(canvas, vatLabel, order.vatAmount, y, textSmall, rowGap = scale(9f), bold = false)
    canvas.drawLine(margin, y + scale(3f), widthPx - margin, y + scale(3f), linePaint)
    y += scale(14f)
    y = drawTotalRow(canvas, totalLabel, order.totalWithVat, y, textSmall, rowGap = scale(9f), bold = true)

    // Footer (wrapped if needed)
    y += scale(12f)
    drawCenteredLines(
      canvas = canvas,
      text = footerLabel,
      paint = textMuted,
      y = y,
      maxWidth = widthPx - margin * 2,
      lineGap = scale(6f),
    )

    return bitmap
  }

  private fun measureHeight(
    order: Order,
    logo: Bitmap?,
    textSmall: TextPaint,
    textMuted: TextPaint,
    hasArabic: Boolean,
    footerLabel: String,
  ): Int {
    val sectionGap = scale(16f)
    val rowGap = scale(10f)
    val itemRowGap = scale(6f)
    var h = 0f
    if (logo != null) {
      val logoWidth = (widthPx * 0.58f).toInt()
      val logoHeight = (logoWidth.toFloat() / logo.width * logo.height).toInt()
      h += logoHeight + sectionGap
    }

    val textLarge = TextPaint(textSmall).apply {
      textSize = scale(44f)
      typeface = Typeface.create(typeface, Typeface.BOLD)
    }
    val orderLabelGap = scale(10f)
    val orderTopPadding = scale(12f)
    val orderBottomPadding = scale(14f)
    val orderBlockHeight =
      orderTopPadding + textMuted.textSize + orderLabelGap + textLarge.textSize + orderBottomPadding

    h += orderBlockHeight + sectionGap
    h += textSmall.textSize + textMuted.textSize + rowGap // date/time
    h += rowGap // divider after date/time
    h += textMuted.textSize + scale(8f) // items header
    order.items.forEach { item ->
      val name = resolveItemName(item, hasArabic)
      val price = "${formatMoney(item.price * item.quantity)} SAR"
      val priceWidth = textSmall.measureText(toEnglishDigits(price))
      val leftWidth = (widthPx - margin * 2 - priceWidth - scale(10f)).coerceAtLeast(scale(120f))
      val lines = wrapLines("${item.quantity}x ${name}", textSmall, leftWidth)
      h += lines.size * (textSmall.textSize + itemRowGap)
    }

    h += scale(8f) + rowGap // divider spacing
    h += (textSmall.textSize + scale(9f)) * 2 // subtotal, vat
    h += scale(14f) // divider + gap before total
    h += textSmall.textSize + scale(9f) // total

    val footerLines = wrapLines(footerLabel, textMuted, widthPx - margin * 2)
    h += scale(12f) + footerLines.size * (textMuted.textSize + scale(6f)) + scale(16f)
    return (h + scale(36f)).toInt().coerceAtLeast(240)
  }

  private fun drawCenteredText(canvas: Canvas, text: String, paint: TextPaint, y: Float) {
    val clean = toEnglishDigits(text)
    val x = (widthPx - paint.measureText(clean)) / 2f
    canvas.drawText(clean, x, y, paint)
  }

  private fun drawCenteredLines(
    canvas: Canvas,
    text: String,
    paint: TextPaint,
    y: Float,
    maxWidth: Float,
    lineGap: Float,
  ) {
    val lines = wrapLines(text, paint, maxWidth)
    var yCursor = y
    lines.forEach { line ->
      drawCenteredText(canvas, line, paint, yCursor + paint.textSize)
      yCursor += paint.textSize + lineGap
    }
  }

  private fun drawLabelValue(
    canvas: Canvas,
    label: String,
    value: String,
    x: Float,
    y: Float,
    labelPaint: TextPaint,
    valuePaint: TextPaint,
    alignRight: Boolean,
  ) {
    val labelText = toEnglishDigits(label)
    val valueText = toEnglishDigits(value)
    val labelY = y + labelPaint.textSize
    val valueY = labelY + valuePaint.textSize + scale(4f)
    if (alignRight) {
      canvas.drawText(labelText, x - labelPaint.measureText(labelText), labelY, labelPaint)
      canvas.drawText(valueText, x - valuePaint.measureText(valueText), valueY, valuePaint)
    } else {
      canvas.drawText(labelText, x, labelY, labelPaint)
      canvas.drawText(valueText, x, valueY, valuePaint)
    }
  }

  private fun drawItemRow(
    canvas: Canvas,
    leftText: String,
    rightText: String,
    y: Float,
    paint: TextPaint,
    rowGap: Float,
  ): Float {
    val price = toEnglishDigits(rightText)
    val priceWidth = paint.measureText(price)
    val leftWidth = (widthPx - margin * 2 - priceWidth - scale(10f)).coerceAtLeast(scale(120f))
    val lines = wrapLines(leftText, paint, leftWidth)
    var yCursor = y
    lines.forEachIndexed { idx, line ->
      val lineY = yCursor + paint.textSize
      canvas.drawText(toEnglishDigits(line), margin, lineY, paint)
      if (idx == 0) {
        canvas.drawText(price, widthPx - margin - priceWidth, lineY, paint)
      }
      yCursor += paint.textSize + rowGap
    }
    return yCursor
  }

  private fun drawTotalRow(
    canvas: Canvas,
    label: String,
    value: Double,
    y: Float,
    paint: TextPaint,
    rowGap: Float,
    bold: Boolean,
  ): Float {
    val labelText = label
    val valueText = "${formatMoney(value)} SAR"
    val lineY = y + paint.textSize
    val labelPaint = if (bold) {
      TextPaint(paint).apply { typeface = Typeface.create(paint.typeface, Typeface.BOLD) }
    } else {
      paint
    }
    val valuePaint = if (bold) {
      TextPaint(paint).apply { typeface = Typeface.create(paint.typeface, Typeface.BOLD) }
    } else {
      paint
    }
    canvas.drawText(labelText, margin, lineY, labelPaint)
    val valueWidth = valuePaint.measureText(valueText)
    canvas.drawText(toEnglishDigits(valueText), widthPx - margin - valueWidth, lineY, valuePaint)
    return y + paint.textSize + rowGap
  }

  private fun formatDateTime(ts: Long): Pair<String, String> {
    val dfDate = SimpleDateFormat("MMMM d, yyyy", Locale.US)
    val dfTime = SimpleDateFormat("hh:mm a", Locale.US)
    return Pair(dfDate.format(Date(ts)), dfTime.format(Date(ts)))
  }

  private fun formatMoney(value: Double): String {
    return String.format(Locale.US, "%.2f", value)
  }

  private fun resolveItemName(item: OrderItem, hasArabic: Boolean): String {
    val nameEn = item.nameEn?.takeIf { it.isNotBlank() }
    val nameAr = item.nameAr?.takeIf { it.isNotBlank() }
    val base = item.name.takeIf { it.isNotBlank() }
    if (hasArabic) {
      return base ?: nameAr ?: nameEn ?: "Item"
    }
    val cleaned = stripArabicText(base ?: "")
    return cleaned.ifBlank {
      nameEn ?: stripArabicText(nameAr ?: "")
    }.ifBlank { "Item" }
  }

  private fun stripArabicText(input: String): String {
    val arabicRegex = Regex("[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF]")
    var cleaned = input.replace(arabicRegex, "")
    cleaned = cleaned.replace(Regex("\\s*/\\s*$"), "")
    cleaned = cleaned.replace(Regex("^\\s*/\\s*"), "")
    cleaned = cleaned.replace(Regex("\\s{2,}"), " ").trim()
    return cleaned
  }

  private fun toEnglishDigits(input: String): String {
    val arabic = "٠١٢٣٤٥٦٧٨٩"
    val eastern = "۰۱۲۳۴۵۶۷۸۹"
    val sb = StringBuilder(input.length)
    for (ch in input) {
      val idxA = arabic.indexOf(ch)
      val idxE = eastern.indexOf(ch)
      when {
        idxA >= 0 -> sb.append(idxA)
        idxE >= 0 -> sb.append(idxE)
        else -> sb.append(ch)
      }
    }
    return sb.toString()
  }

  private fun wrapLines(text: String, paint: TextPaint, maxWidth: Float): List<String> {
    val words = text.split(" ")
    val lines = mutableListOf<String>()
    var line = ""
    words.forEach { word ->
      val candidate = if (line.isEmpty()) word else "$line $word"
      if (paint.measureText(candidate) <= maxWidth) {
        line = candidate
      } else {
        if (line.isNotEmpty()) lines.add(line)
        line = word
      }
    }
    if (line.isNotEmpty()) lines.add(line)
    return lines
  }
}
