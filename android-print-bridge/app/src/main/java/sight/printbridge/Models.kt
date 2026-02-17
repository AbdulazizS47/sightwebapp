package sight.printbridge

data class PrintJob(
  val id: Long,
  val orderId: String,
  val order: Order,
)

data class Order(
  val id: String,
  val orderNumber: String,
  val displayNumber: Int,
  val createdAt: Long,
  val phoneNumber: String?,
  val paymentMethod: String,
  val status: String,
  val items: List<OrderItem>,
  val subtotalExclVat: Double,
  val vatAmount: Double,
  val totalWithVat: Double,
)

data class OrderItem(
  val name: String,
  val price: Double,
  val quantity: Int,
  val nameEn: String? = null,
  val nameAr: String? = null,
)
