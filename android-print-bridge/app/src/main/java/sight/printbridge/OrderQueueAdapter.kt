package sight.printbridge

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import sight.printbridge.databinding.ItemOrderQueueBinding
import java.text.DateFormat
import java.util.Date

class OrderQueueAdapter(
  private val onComplete: (QueueOrder) -> Unit,
) : RecyclerView.Adapter<OrderQueueAdapter.ViewHolder>() {
  private val items = mutableListOf<QueueOrder>()

  fun setItems(newItems: List<QueueOrder>) {
    items.clear()
    items.addAll(newItems)
    notifyDataSetChanged()
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
    val inflater = LayoutInflater.from(parent.context)
    val binding = ItemOrderQueueBinding.inflate(inflater, parent, false)
    return ViewHolder(binding, onComplete)
  }

  override fun onBindViewHolder(holder: ViewHolder, position: Int) {
    holder.bind(items[position])
  }

  override fun getItemCount(): Int = items.size

  class ViewHolder(
    private val binding: ItemOrderQueueBinding,
    private val onComplete: (QueueOrder) -> Unit,
  ) : RecyclerView.ViewHolder(binding.root) {
    fun bind(item: QueueOrder) {
      val timeText = if (item.createdAt > 0) {
        DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(item.createdAt))
      } else {
        ""
      }
      binding.orderTitle.text = if (item.displayNumber > 0) {
        if (timeText.isNotBlank()) {
          "#${item.displayNumber} • ${item.orderNumber} • $timeText"
        } else {
          "#${item.displayNumber} • ${item.orderNumber}"
        }
      } else {
        if (timeText.isNotBlank()) {
          "${item.orderNumber} • $timeText"
        } else {
          item.orderNumber
        }
      }
      binding.orderItems.text = item.itemsSummary
      binding.orderTotal.text = String.format("Total: %.2f SAR", item.total)
      binding.completeButton.setOnClickListener { onComplete(item) }
    }
  }
}
