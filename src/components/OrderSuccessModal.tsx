import { CheckCircle, Receipt } from 'lucide-react';
import { motion } from 'motion/react';
import logoImage from 'figma:asset/6a698afc3834913c1c2ac422fa5bd04b815dc28c.png';

interface OrderSuccessModalProps {
  orderId: string;
  orderData: any; // Full order object from the server
  onTrack?: () => void;
  onClose: () => void;
  language: 'en' | 'ar';
}

export function OrderSuccessModal({
  orderData,
  onTrack,
  onClose,
  language,
}: OrderSuccessModalProps) {
  const content = {
    en: {
      success: 'Order Confirmed!',
      message: 'Your order has been received and is being prepared.',
      orderNumber: 'Order Number',
      receiptNumber: 'Receipt Number',
      date: 'Date',
      time: 'Time',
      items: 'Items',
      subtotal: 'Subtotal (excl VAT)',
      vat: 'VAT (15%)',
      total: 'Total (incl VAT)',
      sar: 'SAR',
      payment: 'Payment Method',
      payOnPickup: 'Pay on pickup',
      status: 'Status',
      received: 'Received',
      tracking: 'You will receive updates via SMS.',
      track: 'Track Order',
      continue: 'Continue Browsing',
      thankYou: 'Thank you for your order!',
      customerPhone: 'Customer Phone Number',
    },
    ar: {
      success: 'تم تأكيد الطلب!',
      message: 'تم استلام طلبك ويتم تحضيره.',
      orderNumber: 'رقم الطلب',
      receiptNumber: 'رقم الفاتورة',
      date: 'التاريخ',
      time: 'الوقت',
      items: 'العناصر',
      subtotal: 'المجموع قبل الضريبة',
      vat: 'ضريبة القيمة المضافة (15%)',
      total: 'الإجمالي شامل الضريبة',
      sar: 'ريال',
      payment: 'طريقة الدفع',
      payOnPickup: 'الدفع عند الوصول',
      status: 'الحالة',
      received: 'تم الاستلام',
      tracking: 'سوف تتلقى التحديثات عبر الرسائل النصية القصيرة.',
      track: 'متابعة الطلب',
      continue: 'متابعة التصفح',
      thankYou: 'شكراً لطلبك!',
      customerPhone: 'رقم هاتف العميل',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';

  // Format date and time
  const orderDate = new Date(orderData.createdAt);
  const formattedDate = orderDate.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = orderDate.toLocaleTimeString(language === 'ar' ? 'ar-SA' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const invoiceNumber = orderData.invoiceNumber ?? orderData.orderNumber;
  const paymentLabel =
    orderData.paymentMethod === 'pickup' ||
    orderData.paymentMethod === 'pay_on_pickup' ||
    orderData.paymentMethod === 'cash'
      ? text.payOnPickup
      : orderData.paymentMethod;

  return (
    <div
      className="fixed inset-0 bg-[var(--matte-black)] bg-opacity-90 z-50 flex items-center justify-center p-4 overflow-y-auto"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[var(--crisp-white)] max-w-md w-full my-4"
      >
        {/* Success Header */}
        <div className="bg-[var(--espresso-brown)] p-5 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring' }}
            className="mb-3"
          >
            <CheckCircle size={56} className="text-[var(--crisp-white)] mx-auto" />
          </motion.div>

          <h2 className="text-xl mb-2 text-[var(--crisp-white)]">{text.success}</h2>
          <p className="text-[var(--crisp-white)] opacity-90 text-sm">{text.message}</p>
        </div>

        {/* Receipt Details */}
        <div className="p-6">
          {/* Logo */}
          <div className="flex justify-center mb-5">
            <img src={logoImage} alt="SIGHT / سايت" className="w-40" />
          </div>

          {/* Receipt Header */}
          <div className="flex items-center justify-center gap-2 mb-5 pb-3 border-b-2 border-[var(--matte-black)]">
            <Receipt size={18} className="text-[var(--espresso-brown)]" />
            <span className="text-xs text-[var(--matte-black)] opacity-70">
              {text.receiptNumber}
            </span>
          </div>

          {/* Order Number - Large Display */}
          <div className="mb-5 p-5 bg-[var(--matte-black)] text-center">
            <div className="text-xs text-[var(--crisp-white)] opacity-70 mb-1">
              {text.orderNumber}
            </div>
            <div className="text-3xl text-[var(--crisp-white)] font-mono">
              #{orderData.displayNumber}
            </div>
            <div className="text-[10px] text-[var(--crisp-white)] opacity-50 mt-1 font-mono">
              {invoiceNumber}
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
            <div>
              <div className="text-[var(--matte-black)] opacity-50 mb-1 text-xs">{text.date}</div>
              <div className="text-[var(--matte-black)] text-xs">{formattedDate}</div>
            </div>
            <div className={isRTL ? 'text-left' : 'text-right'}>
              <div className="text-[var(--matte-black)] opacity-50 mb-1 text-xs">{text.time}</div>
              <div className="text-[var(--matte-black)] text-xs">{formattedTime}</div>
            </div>
          </div>

          {/* Customer Phone Number */}
          {orderData.phoneNumber && (
            <div className="mb-5 p-3 bg-[var(--espresso-brown)] text-center">
              <div className="text-[10px] text-[var(--crisp-white)] opacity-70 mb-1">
                {text.customerPhone}
              </div>
              <div className="text-base text-[var(--crisp-white)] font-mono">
                {orderData.phoneNumber}
              </div>
            </div>
          )}

          {/* Order Items */}
          <div className="mb-5 pb-3 border-b border-[var(--matte-black)]">
            <div className="text-xs text-[var(--matte-black)] opacity-70 mb-2">{text.items}</div>
            <div className="space-y-2">
              {orderData.items.map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between text-xs text-[var(--matte-black)]">
                  <span>
                    <span className="inline-block w-5">{item.quantity}×</span>
                    {item.name}
                  </span>
                  <span>
                    {(item.price * item.quantity).toFixed(2)} {text.sar}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-2 mb-5">
            <div className="flex justify-between text-xs text-[var(--matte-black)]">
              <span className="opacity-70">{text.subtotal}</span>
              <span>
                {(orderData.subtotalExclVat ?? orderData.total).toFixed(2)} {text.sar}
              </span>
            </div>
            <div className="flex justify-between text-xs text-[var(--matte-black)]">
              <span className="opacity-70">{text.vat}</span>
              <span>
                {orderData.vatAmount.toFixed(2)} {text.sar}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t-2 border-[var(--matte-black)]">
              <span className="text-sm text-[var(--matte-black)]">{text.total}</span>
              <span className="text-lg text-[var(--espresso-brown)]">
                {(orderData.totalWithVat ?? orderData.total).toFixed(2)} {text.sar}
              </span>
            </div>
          </div>

          {/* Payment & Status */}
          <div className="grid grid-cols-2 gap-3 mb-5 p-3 bg-[var(--cool-gray)] text-xs">
            <div>
              <div className="text-[var(--matte-black)] opacity-50 mb-1">{text.payment}</div>
              <div className="text-[var(--matte-black)] capitalize">{paymentLabel}</div>
            </div>
            <div className={isRTL ? 'text-left' : 'text-right'}>
              <div className="text-[var(--matte-black)] opacity-50 mb-1">{text.status}</div>
              <div className="text-green-600 flex items-center gap-1 justify-end">
                <span className="w-2 h-2 rounded-full bg-green-600"></span>
                {text.received}
              </div>
            </div>
          </div>

          {/* Thank You Message */}
          <div className="text-center mb-5">
            <p className="text-sm text-[var(--matte-black)] opacity-70 mb-1">{text.thankYou}</p>
            <p className="text-xs text-[var(--matte-black)] opacity-50">{text.tracking}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onClose}
              className="py-4 px-4 border-2 border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] transition-colors"
            >
              {text.continue}
            </button>
            <button
              onClick={() => (onTrack ? onTrack() : onClose())}
              className="py-4 px-4 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors"
            >
              {text.track}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
