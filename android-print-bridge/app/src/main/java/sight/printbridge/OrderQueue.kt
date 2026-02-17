package sight.printbridge

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

data class QueueOrder(
  val id: String,
  val orderNumber: String,
  val displayNumber: Int,
  val createdAt: Long,
  val itemsSummary: String,
  val total: Double,
)

object OrderQueue {
  private const val MAX_ITEMS = 50

  fun load(prefs: SharedPreferences): List<QueueOrder> {
    val raw = prefs.getString(StatusKeys.QUEUE_JSON, "[]") ?: "[]"
    return fromJson(raw)
  }

  fun fromJson(raw: String): List<QueueOrder> {
    val list = mutableListOf<QueueOrder>()
    try {
      val arr = JSONArray(raw)
      for (i in 0 until arr.length()) {
        val obj = arr.getJSONObject(i)
        list.add(
          QueueOrder(
            id = obj.optString("id", ""),
            orderNumber = obj.optString("orderNumber", ""),
            displayNumber = obj.optInt("displayNumber", 0),
            createdAt = obj.optLong("createdAt", 0L),
            itemsSummary = obj.optString("itemsSummary", ""),
            total = obj.optDouble("total", 0.0),
          )
        )
      }
    } catch (_: JSONException) {
      return emptyList()
    }
    return list
  }

  fun add(prefs: SharedPreferences, order: Order): List<QueueOrder> {
    val list = load(prefs).toMutableList()
    if (list.any { it.id == order.id }) return list
    val summary = order.items.joinToString(", ") { "${it.name} x${it.quantity}" }
    val createdAt = if (order.createdAt > 0) order.createdAt else System.currentTimeMillis()
    val entry = QueueOrder(
      id = order.id,
      orderNumber = order.orderNumber,
      displayNumber = order.displayNumber,
      createdAt = createdAt,
      itemsSummary = summary,
      total = order.totalWithVat,
    )
    list.add(0, entry)
    if (list.size > MAX_ITEMS) {
      list.subList(MAX_ITEMS, list.size).clear()
    }
    save(prefs, list)
    return list
  }

  fun remove(prefs: SharedPreferences, orderId: String): List<QueueOrder> {
    val list = load(prefs).filterNot { it.id == orderId }
    save(prefs, list)
    return list
  }

  private fun save(prefs: SharedPreferences, list: List<QueueOrder>) {
    val arr = JSONArray()
    for (item in list) {
      val obj = JSONObject()
        .put("id", item.id)
        .put("orderNumber", item.orderNumber)
        .put("displayNumber", item.displayNumber)
        .put("createdAt", item.createdAt)
        .put("itemsSummary", item.itemsSummary)
        .put("total", item.total)
      arr.put(obj)
    }
    prefs.edit().putString(StatusKeys.QUEUE_JSON, arr.toString()).apply()
  }
}
