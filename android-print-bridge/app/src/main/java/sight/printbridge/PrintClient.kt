package sight.printbridge

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class PrintClient(private val serverUrl: String, private val deviceKey: String) {
  private val client = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .writeTimeout(20, TimeUnit.SECONDS)
    .build()
  private val jsonMedia = "application/json".toMediaType()

  fun ping() {
    val request = Request.Builder()
      .url("${serverUrl.trimEnd('/')}/api/health")
      .get()
      .build()
    execute(request)
  }

  fun pingDeviceKey() {
    val request = Request.Builder()
      .url("${serverUrl.trimEnd('/')}/api/print/ping")
      .addHeader("X-Device-Key", deviceKey)
      .get()
      .build()
    val body = execute(request)
    try {
      val json = JSONObject(body)
      if (!json.optBoolean("success", false)) {
        val err = json.optString("error", "Unauthorized")
        throw ApiException(
          message = "Device key check failed: $err",
          url = request.url.toString(),
          body = body,
        )
      }
    } catch (e: JSONException) {
      throw ApiException(
        message = "Device key check failed: invalid JSON",
        url = request.url.toString(),
        body = body,
        cause = e,
      )
    }
  }

  fun claimJob(): PrintJob? {
    val request = Request.Builder()
      .url("${serverUrl.trimEnd('/')}/api/print/jobs/claim")
      .addHeader("X-Device-Key", deviceKey)
      .post("{}".toRequestBody(jsonMedia))
      .build()

    val body = execute(request)
    try {
      val json = JSONObject(body)
      if (!json.optBoolean("success", false)) {
        val err = json.optString("error", "Unknown error")
        throw ApiException(
          message = "Claim failed: $err",
          url = request.url.toString(),
          body = body,
        )
      }
      val jobObj = json.optJSONObject("job") ?: return null
      if (jobObj == JSONObject.NULL) return null

      val orderObj = jobObj.getJSONObject("order")
      val items = orderObj.getJSONArray("items").toOrderItems()

      val order = Order(
        id = orderObj.getString("id"),
        orderNumber = orderObj.getString("orderNumber"),
        displayNumber = orderObj.optInt("displayNumber", 0),
        createdAt = orderObj.optLong("createdAt", System.currentTimeMillis()),
        phoneNumber = orderObj.optString("phoneNumber", null),
        paymentMethod = orderObj.optString("paymentMethod", "cash"),
        status = orderObj.optString("status", "received"),
        items = items,
        subtotalExclVat = orderObj.optDouble("subtotalExclVat", 0.0),
        vatAmount = orderObj.optDouble("vatAmount", 0.0),
        totalWithVat = orderObj.optDouble("totalWithVat", orderObj.optDouble("total", 0.0)),
      )

      return PrintJob(
        id = jobObj.getLong("id"),
        orderId = jobObj.getString("orderId"),
        order = order,
      )
    } catch (e: JSONException) {
      throw ApiException(
        message = "Claim failed: invalid JSON",
        url = request.url.toString(),
        body = body,
        cause = e,
      )
    }
  }

  fun ack(jobId: Long) {
    val req = Request.Builder()
      .url("${serverUrl.trimEnd('/')}/api/print/jobs/${jobId}/ack")
      .addHeader("X-Device-Key", deviceKey)
      .post("{}".toRequestBody(jsonMedia))
      .build()
    execute(req)
  }

  fun fail(jobId: Long, error: String, retry: Boolean) {
    val body = JSONObject(mapOf("error" to error, "retry" to retry)).toString()
    val req = Request.Builder()
      .url("${serverUrl.trimEnd('/')}/api/print/jobs/${jobId}/fail")
      .addHeader("X-Device-Key", deviceKey)
      .post(body.toRequestBody(jsonMedia))
      .build()
    execute(req)
  }

  private fun execute(request: Request): String {
    client.newCall(request).execute().use { resp ->
      val body = resp.body?.string() ?: ""
      if (!resp.isSuccessful) {
        val msg = "HTTP ${resp.code} ${resp.message}".trim()
        throw ApiException(
          message = msg,
          code = resp.code,
          url = request.url.toString(),
          body = body,
        )
      }
      return body
    }
  }
}

private fun JSONArray.toOrderItems(): List<OrderItem> {
  val items = mutableListOf<OrderItem>()
  for (i in 0 until length()) {
    val obj = getJSONObject(i)
    val rawName = obj.optString("name", "")
    val nameEn = obj.optString("nameEn", "").takeIf { it.isNotBlank() }
    val nameAr = obj.optString("nameAr", "").takeIf { it.isNotBlank() }
    val name = rawName.ifBlank { nameEn ?: nameAr ?: "" }
    items.add(
      OrderItem(
        name = name,
        price = obj.optDouble("price", 0.0),
        quantity = obj.optInt("quantity", 1),
        nameEn = nameEn,
        nameAr = nameAr,
      )
    )
  }
  return items
}

class ApiException(
  message: String,
  val code: Int? = null,
  val url: String? = null,
  val body: String? = null,
  cause: Throwable? = null,
) : Exception(message, cause)
