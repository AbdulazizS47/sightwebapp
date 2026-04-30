import { useEffect, useState } from 'react';
import { X, Plus, Minus, Banknote } from 'lucide-react';
import { getApiRequestUrls } from '../utils/api';

type DrinkTemperature = 'hot' | 'iced';

interface CartItem {
  id: string;
  cartKey?: string;
  nameEn: string;
  nameAr: string;
  price: number;
  quantity: number;
  temperature?: DrinkTemperature;
}

interface PricingSummary {
  itemsTotal: number;
  subtotalExclVat: number;
  vatAmount: number;
  total: number;
  totalWithVat: number;
  rewardType: 'free' | 'half' | null;
  rewardApplied: boolean;
  rewardDiscountAmount: number;
  discountCodeRequested: string | null;
  discountCodeApplied: boolean;
  discountCode: string | null;
  discountCodeName: string | null;
  discountCodeAmount: number;
  discountCodeError: string | null;
}

interface CartModalProps {
  onClose: () => void;
  items: CartItem[];
  onUpdateCart: (...args: [CartItem[]]) => void;
  onOrderComplete: (...args: [string, any]) => void;
  onAuthRequired: () => void;
  sessionToken: string | null;
  language: 'en' | 'ar';
  discountCodeInput: string;
  onDiscountCodeInputChange: (...args: [string]) => void;
  appliedDiscountCode: string | null;
  onAppliedDiscountCodeChange: (...args: [string | null]) => void;
}

function normalizeDiscountCodeValue(value: string) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function CartModal({
  onClose,
  items,
  onUpdateCart,
  onOrderComplete,
  onAuthRequired,
  sessionToken,
  language,
  discountCodeInput,
  onDiscountCodeInputChange,
  appliedDiscountCode,
  onAppliedDiscountCodeChange,
}: CartModalProps) {
  const [loading, setLoading] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [error, setError] = useState('');
  const [loyalty, setLoyalty] = useState<{ enabled: boolean; stamps: number } | null>(null);
  const [redeemReward, setRedeemReward] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
      processLoading: 'Processing...',
      redeemReward: 'Redeem reward',
      freeCup: 'Free cup',
      halfOff: '50% off',
      discountCap: 'max 20 SAR',
      rewardApplied: 'Reward applied',
      discountCode: 'Discount code',
      discountCodePlaceholder: 'Enter code',
      applyCode: 'Apply',
      removeCode: 'Remove',
      codeApplied: 'Code applied',
      codeDiscount: 'Discount code',
      validatingCode: 'Updating total...',
      confirmTitle: 'Confirm Order',
      confirmMessage: 'Your order will be ready within 10 minutes. Pay on pickup.',
      confirmButton: 'Confirm Order',
      cancelButton: 'Cancel',
      hot: 'Hot',
      iced: 'Iced',
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
      processLoading: 'جارٍ المعالجة...',
      redeemReward: 'استبدال المكافأة',
      freeCup: 'كوب مجاني',
      halfOff: 'خصم 50%',
      discountCap: 'حد أقصى 20 ريال',
      rewardApplied: 'تم تطبيق المكافأة',
      discountCode: 'كود الخصم',
      discountCodePlaceholder: 'أدخل الكود',
      applyCode: 'تطبيق',
      removeCode: 'إزالة',
      codeApplied: 'تم تطبيق الكود',
      codeDiscount: 'خصم الكود',
      validatingCode: 'جارٍ تحديث الإجمالي...',
      confirmTitle: 'تأكيد الطلب',
      confirmMessage: 'سيكون طلبك جاهزًا خلال 10 دقائق. الدفع عند الاستلام.',
      confirmButton: 'تأكيد الطلب',
      cancelButton: 'إلغاء',
      hot: 'ساخن',
      iced: 'بارد',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';
  const vatRate = 0.15;
  const maxRewardDiscount = 20;

  const getCartKey = (item: CartItem) => item.cartKey || item.id;
  const previewEndpointUrls = getApiRequestUrls('/orders/price-preview');
  const createOrderEndpointUrls = getApiRequestUrls('/orders/create');
  const loyaltyEndpointUrls = getApiRequestUrls('/profile/loyalty');

  const getTemperatureLabel = (temperature?: DrinkTemperature) => {
    if (!temperature) return '';
    return temperature === 'hot' ? text.hot : text.iced;
  };

  const fetchJsonWithFallback = async (urls: string[], init?: RequestInit) => {
    let lastError: Error | null = null;

    for (const url of urls) {
      try {
        const response = await fetch(url, init);
        const data = await response.json().catch(() => ({}));
        return { response, data, url };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Request failed');
      }
    }

    throw lastError || new Error('Request failed');
  };

  const updateQuantity = (cartKey: string, change: number) => {
    const updatedItems = items
      .map((item) =>
        getCartKey(item) === cartKey
          ? { ...item, quantity: Math.max(0, item.quantity + change) }
          : item
      )
      .filter((item) => item.quantity > 0);

    onUpdateCart(updatedItems);
  };

  const itemsTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const rewardType =
    loyalty?.enabled && loyalty.stamps === 3
      ? 'free'
      : loyalty?.enabled && loyalty.stamps === 6
        ? 'half'
        : null;
  const rewardActive = Boolean(redeemReward && rewardType);
  const maxUnitPrice = items.reduce((max, item) => Math.max(max, item.price || 0), 0);
  const rewardDiscountAmount = rewardActive
    ? rewardType === 'free'
      ? Math.min(maxUnitPrice, itemsTotal)
      : Math.min(itemsTotal * 0.5, maxRewardDiscount)
    : 0;
  const fallbackTotal = Math.max(0, itemsTotal - rewardDiscountAmount);
  const fallbackVatAmount = fallbackTotal * (vatRate / (1 + vatRate));
  const fallbackSubtotal = fallbackTotal - fallbackVatAmount;

  const buildFallbackPricing = (): PricingSummary => ({
    itemsTotal,
    subtotalExclVat: fallbackSubtotal,
    vatAmount: fallbackVatAmount,
    total: fallbackTotal,
    totalWithVat: fallbackTotal,
    rewardType,
    rewardApplied: rewardDiscountAmount > 0,
    rewardDiscountAmount,
    discountCodeRequested: appliedDiscountCode,
    discountCodeApplied: false,
    discountCode: null,
    discountCodeName: null,
    discountCodeAmount: 0,
    discountCodeError: null,
  });

  const [pricing, setPricing] = useState<PricingSummary>(() => buildFallbackPricing());

  useEffect(() => {
    setPricing(buildFallbackPricing());
  }, [itemsTotal, fallbackSubtotal, fallbackVatAmount, fallbackTotal, rewardType, rewardDiscountAmount]);

  useEffect(() => {
    if (!sessionToken) {
      setLoyalty(null);
      setRedeemReward(false);
      return;
    }

    fetchJsonWithFallback(loyaltyEndpointUrls, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(({ data: j }) => {
        if (j.success && j.loyalty) {
          const points = Number(j.loyalty.points || 0);
          const stamps = points > 0 ? ((points - 1) % 6) + 1 : 0;
          setLoyalty({ enabled: Boolean(Number(j.loyalty.enabled)), stamps });
        }
      })
      .catch(() => {});
  }, [sessionToken]);

  useEffect(() => {
    if (items.length === 0) return;

    let ignore = false;

    const loadPreview = async () => {
      setPricingLoading(true);
      try {
        const { response, data } = await fetchJsonWithFallback(previewEndpointUrls, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          },
          body: JSON.stringify({
            items: items.map((item) => ({
              id: item.id,
              quantity: item.quantity,
              options: item.temperature ? { temperature: item.temperature } : undefined,
            })),
            redeemReward,
            discountCode: appliedDiscountCode,
            language,
          }),
        });

        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to preview order');
        }

        if (ignore) return;
        setPricing(data.pricing);
      } catch (previewError) {
        if (!ignore) {
          setPricing({
            ...buildFallbackPricing(),
            discountCodeRequested: appliedDiscountCode,
            discountCodeError:
              previewError instanceof Error ? previewError.message : 'Failed to update pricing',
          });
        }
      } finally {
        if (!ignore) {
          setPricingLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      ignore = true;
    };
  }, [items, redeemReward, appliedDiscountCode, sessionToken, language]);

  const processOrder = async () => {
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
      const { response, data } = await fetchJsonWithFallback(createOrderEndpointUrls, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            options: item.temperature ? { temperature: item.temperature } : undefined,
          })),
          paymentMethod,
          language,
          redeemReward,
          discountCode: appliedDiscountCode,
        }),
      });

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
              name: `${language === 'en' ? item.nameEn : item.nameAr}${
                item.temperature ? ` · ${getTemperatureLabel(item.temperature)}` : ''
              }`,
              nameEn: `${item.nameEn}${
                item.temperature ? ` · ${item.temperature === 'hot' ? 'Hot' : 'Iced'}` : ''
              }`,
              nameAr: `${item.nameAr}${
                item.temperature ? ` · ${item.temperature === 'hot' ? 'ساخن' : 'بارد'}` : ''
              }`,
              price: item.price,
              options: item.temperature ? { temperature: item.temperature } : undefined,
            })),
            total: pricing.total,
            subtotalExclVat: pricing.subtotalExclVat,
            vatAmount: pricing.vatAmount,
            totalWithVat: pricing.totalWithVat,
            paymentMethod,
            status: 'received',
            discountCode: pricing.discountCode,
            discountCodeAmount: pricing.discountCodeAmount,
          };

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

  const handleApplyDiscountCode = () => {
    setError('');
    const normalized = normalizeDiscountCodeValue(discountCodeInput);
    onDiscountCodeInputChange(normalized);
    onAppliedDiscountCodeChange(normalized || null);
  };

  const handleRemoveDiscountCode = () => {
    setError('');
    onDiscountCodeInputChange('');
    onAppliedDiscountCodeChange(null);
  };

  const handleProcessOrder = () => {
    if (!sessionToken) {
      onAuthRequired();
      return;
    }
    if (items.length === 0) {
      setError('Cart is empty');
      return;
    }
    setError('');
    setShowConfirm(true);
  };

  return (
    <div
      className="fixed inset-0 bg-[var(--crisp-white)] z-50 overflow-y-auto"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {showConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-[var(--crisp-white)] border-2 border-[var(--matte-black)] max-w-sm w-full p-5">
            <h3 className="text-lg text-[var(--matte-black)] mb-2">{text.confirmTitle}</h3>
            <p className="text-sm text-[var(--matte-black)] opacity-80 mb-5">
              {text.confirmMessage}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  void processOrder();
                }}
                disabled={loading}
                className="flex-1 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors text-sm"
              >
                {loading ? '...' : text.confirmButton}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 border-2 border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] transition-colors text-sm"
              >
                {text.cancelButton}
              </button>
            </div>
          </div>
        </div>
      )}

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

      <div className="p-4">
        {items.length === 0 ? (
          <div className="text-center py-16 text-[var(--matte-black)] opacity-50">{text.empty}</div>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              {items.map((item) => {
                const cartKey = getCartKey(item);
                const temperatureLabel = getTemperatureLabel(item.temperature);

                return (
                  <div key={cartKey} className="flex items-center gap-3 p-4 bg-[var(--cool-gray)]">
                    <div className="flex-1 min-w-0">
                      <h3 className="mb-1 text-[var(--matte-black)]">
                        {language === 'en' ? item.nameEn : item.nameAr}
                      </h3>
                      {temperatureLabel && (
                        <div className="text-[11px] text-[var(--matte-black)] opacity-60 mb-1">
                          {temperatureLabel}
                        </div>
                      )}
                      <div className="text-sm text-[var(--matte-black)] opacity-70">
                        {item.price} {text.sar}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateQuantity(cartKey, -1)}
                        className="w-10 h-10 bg-[var(--espresso-brown)] text-[var(--crisp-white)] flex items-center justify-center hover:bg-[var(--matte-black)] transition-colors"
                      >
                        <Minus size={16} />
                      </button>

                      <span className="w-8 text-center text-[var(--matte-black)]">
                        {item.quantity}
                      </span>

                      <button
                        onClick={() => updateQuantity(cartKey, 1)}
                        className="w-10 h-10 bg-[var(--espresso-brown)] text-[var(--crisp-white)] flex items-center justify-center hover:bg-[var(--matte-black)] transition-colors"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {loyalty?.enabled && loyalty.stamps === 3 && (
              <div className="mb-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={redeemReward}
                    onChange={(e) => setRedeemReward(e.target.checked)}
                  />
                  <span>
                    {text.redeemReward} - {text.freeCup}
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
                    onChange={(e) => setRedeemReward(e.target.checked)}
                  />
                  <span>
                    {text.redeemReward} - {text.halfOff} ({text.discountCap})
                  </span>
                </label>
              </div>
            )}

            <div className="border border-[var(--matte-black)] p-4 mb-4">
              <div className="text-sm text-[var(--matte-black)] mb-2">{text.discountCode}</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={discountCodeInput}
                  onChange={(e) => onDiscountCodeInputChange(e.target.value.toUpperCase())}
                  placeholder={text.discountCodePlaceholder}
                  className="flex-1 px-3 py-2 border border-[var(--matte-black)] bg-[var(--crisp-white)] text-[var(--matte-black)]"
                />
                {appliedDiscountCode ? (
                  <button
                    onClick={handleRemoveDiscountCode}
                    disabled={pricingLoading || loading}
                    className="px-4 py-2 border-2 border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] transition-colors disabled:opacity-60"
                  >
                    {text.removeCode}
                  </button>
                ) : (
                  <button
                    onClick={handleApplyDiscountCode}
                    disabled={!normalizeDiscountCodeValue(discountCodeInput) || pricingLoading || loading}
                    className="px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-60"
                  >
                    {text.applyCode}
                  </button>
                )}
              </div>
              {pricing.discountCodeApplied && pricing.discountCode && (
                <div className="mt-2 text-sm text-green-700">
                  {text.codeApplied}: {pricing.discountCode}
                </div>
              )}
              {pricing.discountCodeError && (
                <div className="mt-2 text-sm text-red-600">{pricing.discountCodeError}</div>
              )}
              {pricingLoading && (
                <div className="mt-2 text-xs text-[var(--matte-black)] opacity-60">
                  {text.validatingCode}
                </div>
              )}
            </div>

            <div className="bg-[var(--cool-gray)] p-4 mb-6">
              <div className="flex justify-between text-[var(--matte-black)]">
                <span>{text.subtotal}</span>
                <span>
                  {pricing.subtotalExclVat.toFixed(2)} {text.sar}
                </span>
              </div>
              <div className="flex justify-between text-[var(--matte-black)] opacity-70">
                <span>{text.vat}</span>
                <span>
                  {pricing.vatAmount.toFixed(2)} {text.sar}
                </span>
              </div>
              {pricing.rewardApplied && (
                <div className="flex justify-between text-green-700 text-sm mt-1">
                  <span>{text.rewardApplied}</span>
                  <span>
                    -{pricing.rewardDiscountAmount.toFixed(2)} {text.sar}
                  </span>
                </div>
              )}
              {pricing.discountCodeApplied && pricing.discountCodeAmount > 0 && (
                <div className="flex justify-between text-green-700 text-sm mt-1">
                  <span>
                    {text.codeDiscount}
                    {pricing.discountCode ? ` (${pricing.discountCode})` : ''}
                  </span>
                  <span>
                    -{pricing.discountCodeAmount.toFixed(2)} {text.sar}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-[var(--matte-black)] font-bold mt-2">
                <span>{text.total}</span>
                <span>
                  {pricing.totalWithVat.toFixed(2)} {text.sar}
                </span>
              </div>
            </div>

            <div className="mb-6">
              <div className="text-[var(--matte-black)] mb-2">{text.payment}</div>
              <div className="flex items-center gap-2 p-3 border bg-[var(--cool-gray)] text-[var(--matte-black)]">
                <Banknote size={16} />
                {text.payOnPickup}
              </div>
            </div>

            {error && <div className="text-red-600 mb-4">{error}</div>}

            <button
              onClick={handleProcessOrder}
              disabled={loading}
              className={`w-full py-3 ${
                loading ? 'bg-[var(--cool-gray)]' : 'bg-[var(--espresso-brown)]'
              } text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors`}
            >
              {loading ? text.processLoading : text.process}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
