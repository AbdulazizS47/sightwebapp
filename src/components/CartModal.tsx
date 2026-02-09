import { useState, useEffect } from 'react';
import { X, Plus, Minus, Banknote } from 'lucide-react';
// Removed Supabase legacy imports
// import { supabaseUrl, publicAnonKey, supabaseFunctionName } from '../utils/supabase/info';
import { apiBaseUrl } from '../utils/supabase/info';

interface CartItem {
  id: string;
  nameEn: string;
  nameAr: string;
  price: number;
  quantity: number;
}

interface CartModalProps {
  onClose: () => void;
  items: CartItem[];
  onUpdateCart: (...args: [CartItem[]]) => void;
  onOrderComplete: (...args: [string, any]) => void;
  onAuthRequired: () => void;
  sessionToken: string | null;
  language: 'en' | 'ar';
}

export function CartModal({
  onClose,
  items,
  onUpdateCart,
  onOrderComplete,
  onAuthRequired,
  sessionToken,
  language,
}: CartModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loyalty, setLoyalty] = useState<{ enabled: boolean; stamps: number } | null>(null);
  const [redeemReward, setRedeemReward] = useState(false);
  const paymentMethod = 'pickup' as const;

  const content = {
    en: {
      cart: 'Your Cart',
      empty: 'Your cart is empty',
      subtotal: 'Subtotal (excl VAT)',
      vat: 'VAT (15%)',
      total: 'Total',
      sar: 'SAR',
      payment: 'Payment Method',
      payOnPickup: 'Pay on pickup',
      process: 'Process Order',
      signInRequired: 'Please sign in to place an order',
      signInPrompt: 'Sign in with your phone number to complete your order',
      signInButton: 'Sign In to Order',
      redeemReward: 'Redeem reward',
      freeCup: 'Free cup',
      halfOff: '50% off',
      discountCap: 'max 20 SAR',
      rewardApplied: 'Reward applied',
    },
    ar: {
      cart: 'سلتك',
      empty: 'سلتك فارغة',
      subtotal: 'المجموع قبل الضريبة',
      vat: 'ضريبة القيمة المضافة (15%)',
      total: 'الإجمالي',
      sar: 'ريال',
      payment: 'طريقة الدفع',
      payOnPickup: 'الدفع عند الوصول',
      process: 'إتمام الطلب',
      signInRequired: 'الرجاء تسجيل الدخول لإتمام الطلب',
      signInPrompt: 'سجل الدخول برقم هاتفك لإكمال طلبك',
      signInButton: 'تسجيل الدخول للطلب',
      redeemReward: 'Redeem reward',
      freeCup: 'Free cup',
      halfOff: '50% off',
      discountCap: 'max 20 SAR',
      rewardApplied: 'Reward applied',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';
  const VAT_RATE = 0.15;
  const maxDiscount = 20; // SAR limit for 50% off (discount amount)

  const updateQuantity = (id: string, change: number) => {
    const updatedItems = items
      .map((item) =>
        item.id === id ? { ...item, quantity: Math.max(0, item.quantity + change) } : item
      )
      .filter((item) => item.quantity > 0);

    onUpdateCart(updatedItems);
  };

  // Prices are VAT-inclusive. We display the VAT portion without adding it on top.
  const itemsTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const rewardType =
    loyalty?.enabled && loyalty.stamps === 3
      ? 'free'
      : loyalty?.enabled && loyalty.stamps === 6
        ? 'half'
        : null;
  const rewardActive = Boolean(redeemReward && rewardType);
  const maxUnitPrice = items.reduce((max, item) => Math.max(max, item.price || 0), 0);

  const discountAmount = rewardActive
    ? rewardType === 'free'
      ? Math.min(maxUnitPrice, itemsTotal)
      : Math.min(itemsTotal * 0.5, maxDiscount)
    : 0;

  const finalTotal = Math.max(0, itemsTotal - discountAmount);
  const vatAmount = finalTotal * (VAT_RATE / (1 + VAT_RATE));
  const subtotalExclVat = finalTotal - vatAmount;

  // Fetch loyalty on mount
  useEffect(() => {
    if (!sessionToken) return;
    fetch(`${apiBaseUrl}/profile/loyalty`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success && j.loyalty) {
          const p = Number(j.loyalty.points || 0);
          const stamps = p > 0 ? ((p - 1) % 6) + 1 : 0;
          setLoyalty({ enabled: Boolean(Number(j.loyalty.enabled)), stamps });
        }
      })
      .catch(() => {});
  }, [sessionToken]);

  const handleProcessOrder = async () => {
    if (!sessionToken) {
      onAuthRequired();
      return;
    }

    if (items.length === 0) {
      setError('Cart is empty');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiBaseUrl}/orders/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
          })),
          paymentMethod,
          language,
          redeemReward,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create order');
      }

      const order = data.order || null;
      const orderData = order
        ? {
            ...order,
            invoiceNumber: order.orderNumber,
          }
        : {
            displayNumber: data.displayNumber,
            invoiceNumber: data.orderNumber,
            createdAt: Date.now(),
            phoneNumber: null,
            items: items.map((item) => ({
              quantity: item.quantity,
              name: language === 'en' ? item.nameEn : item.nameAr,
              price: item.price,
            })),
            total: finalTotal,
            subtotalExclVat,
            vatAmount,
            totalWithVat: finalTotal,
            paymentMethod,
            status: 'received',
          };

      // Clear cart and show success
      onUpdateCart([]);
      onOrderComplete(order?.id || data.orderId, orderData);
      onClose();
    } catch (err: any) {
      console.error('Error creating order:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--crisp-white)] z-50 overflow-y-auto"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div className="sticky top-0 bg-[var(--crisp-white)] border-b border-[var(--matte-black)] z-10">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg text-[var(--matte-black)]">{text.cart}</h2>
          <button
            onClick={onClose}
            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {items.length === 0 ? (
          <div className="text-center py-16 text-[var(--matte-black)] opacity-50">{text.empty}</div>
        ) : (
          <>
            {/* Cart Items */}
            <div className="space-y-3 mb-6">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-4 bg-[var(--cool-gray)]">
                  <div className="flex-1 min-w-0">
                    <h3 className="mb-1 text-[var(--matte-black)]">
                      {language === 'en' ? item.nameEn : item.nameAr}
                    </h3>
                    <div className="text-sm text-[var(--matte-black)] opacity-70">
                      {item.price} {text.sar}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      className="w-10 h-10 bg-[var(--espresso-brown)] text-[var(--crisp-white)] flex items-center justify-center hover:bg-[var(--matte-black)] transition-colors"
                    >
                      <Minus size={16} />
                    </button>

                    <span className="w-8 text-center text-[var(--matte-black)]">
                      {item.quantity}
                    </span>

                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="w-10 h-10 bg-[var(--espresso-brown)] text-[var(--crisp-white)] flex items-center justify-center hover:bg-[var(--matte-black)] transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Loyalty reward toggle */}
            {loyalty?.enabled && loyalty.stamps === 3 && (
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={redeemReward}
                    onChange={(e) => {
                      setRedeemReward(e.target.checked);
                    }}
                  />
                  <span>
                    {text.redeemReward} – {text.freeCup}
                  </span>
                </label>
              </div>
            )}
            {loyalty?.enabled && loyalty.stamps === 6 && (
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={redeemReward}
                    onChange={(e) => {
                      setRedeemReward(e.target.checked);
                    }}
                  />
                  <span>
                    {text.redeemReward} – {text.halfOff} ({text.discountCap})
                  </span>
                </label>
              </div>
            )}
            {/* Subtotal, VAT, Total */}
            <div className="bg-[var(--cool-gray)] p-4 mb-6">
              <div className="flex justify-between text-[var(--matte-black)]">
                <span>{text.subtotal}</span>
                <span>
                  {subtotalExclVat.toFixed(2)} {text.sar}
                </span>
              </div>
              <div className="flex justify-between text-[var(--matte-black)] opacity-70">
                <span>{text.vat}</span>
                <span>
                  {vatAmount.toFixed(2)} {text.sar}
                </span>
              </div>
              {rewardActive && (
                <div className="flex justify-between text-green-700 text-sm mt-1">
                  <span>{text.rewardApplied}</span>
                  <span>
                    -{discountAmount.toFixed(2)} {text.sar}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-[var(--matte-black)] font-bold mt-2">
                <span>{text.total}</span>
                <span>
                  {finalTotal.toFixed(2)} {text.sar}
                </span>
              </div>
            </div>

            {/* Payment Method */}
            <div className="mb-6">
              <div className="text-[var(--matte-black)] mb-2">{text.payment}</div>
              <div className="flex items-center gap-2 p-3 border bg-[var(--cool-gray)] text-[var(--matte-black)]">
                <Banknote size={16} />
                {text.payOnPickup}
              </div>
            </div>

            {/* Error Message */}
            {error && <div className="text-red-600 mb-4">{error}</div>}

            {/* Process Order Button */}
            <button
              onClick={handleProcessOrder}
              disabled={loading}
              className={`w-full py-3 ${loading ? 'bg-[var(--cool-gray)]' : 'bg-[var(--espresso-brown)]'} text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors`}
            >
              {loading ? 'Processing...' : text.process}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
