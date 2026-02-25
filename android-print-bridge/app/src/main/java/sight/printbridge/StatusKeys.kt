package sight.printbridge

object StatusKeys {
  const val PREFS = "print_bridge"
  const val SERVER_STATUS = "serverStatus"
  const val PRINTER_STATUS = "printerStatus"
  const val SERVICE_STATUS = "serviceStatus"
  const val LAST_ORDER = "lastOrder"
  const val LAST_ORDER_AT = "lastOrderAt"
  const val LAST_ERROR = "lastError"
  const val LAST_ERROR_AT = "lastErrorAt"
  const val QUEUE_JSON = "orderQueueJson"
  const val RECEIPT_WIDTH_PX = "receiptWidthPx"
  const val RECEIPT_WIDTH_58MM = 384
  const val RECEIPT_WIDTH_80MM = 512
  const val DEFAULT_RECEIPT_WIDTH_PX = RECEIPT_WIDTH_80MM
  const val RECEIPT_LAYOUT_VERSION = "receiptLayoutVersion"
  const val RECEIPT_LAYOUT_VERSION_CURRENT = 3
}
