import { PromotionPicker, PromotionSummary, promoKey, type Promotion, type PromoSelection } from './PromotionControls';
import { useEffect, useMemo, useState } from 'react';
import { LogOut, Minus, Plus, ShoppingBag } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { getApiRequestUrls } from '../utils/api';
import { resolveImageUrl } from '../utils/media';

interface MenuItem {
  promotion?: Promotion | null;
  id: string;
  nameEn: string;
  nameAr: string;
  price: number;
  category: string;
  available: boolean;
  imageUrl?: string | null;
}

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
}

type DrinkTemperature = 'hot' | 'iced';

interface CartLine {
  selections?: PromoSelection[];
  id: string;
  cartKey: string;
  nameEn: string;
  nameAr: string;
  price: number;
  quantity: number;
  temperature?: DrinkTemperature;
}

interface PricingSummary {
  subtotalExclVat: number;
  vatAmount: number;
  totalWithVat: number;
}

interface CashierUser {
  id: string;
  name: string;
  phoneNumber: string;
}

interface CashierPageProps {
  sessionToken: string;
  cashierUser: CashierUser;
  language: 'en' | 'ar';
  onLogout: () => void;
}

export function CashierPage({ sessionToken, cashierUser, language, onLogout }: CashierPageProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingPromoKey, setEditingPromoKey] = useState<string | null>(null);
  const [promoItem, setPromoItem] = useState<MenuItem | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedTemperatures, setSelectedTemperatures] = useState<
    Record<string, DrinkTemperature>
  >({});
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [customerPhone, setCustomerPhone] = useState('');
  const [pricing, setPricing] = useState<PricingSummary | null>(null);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{
    orderNumber: string;
    displayNumber: number;
  } | null>(null);

  const isRTL = language === 'ar';
  const vatRate = 0.15;

  const content = {
    en: {
      title: 'New Order',
      signedInAs: 'Cashier',
      signOut: 'Sign out',
      cart: 'Order',
      empty: 'Tap an item to add it',
      subtotal: 'Subtotal (excl VAT)',
      vat: 'VAT (15%)',
      total: 'Total',
      sar: 'SAR',
      payment: 'Payment',
      cash: 'Cash',
      card: 'Card',
      phoneLabel: 'Customer phone (optional)',
      phoneHint: 'Enrolls the customer in loyalty and lets them track this order.',
      phonePlaceholder: '05XXXXXXXX',
      submit: 'Place Order',
      submitting: 'Placing order...',
      newOrder: 'Start New Order',
      confirmedTitle: 'Order placed',
      orderNo: 'Order #',
      loadingMenu: 'Loading menu...',
      temperature: 'Temperature',
      hot: 'Hot',
      iced: 'Iced',
    },
    ar: {
      title: 'طلب جديد',
      signedInAs: 'الكاشير',
      signOut: 'تسجيل الخروج',
      cart: 'الطلب',
      empty: 'اضغط على عنصر لإضافته',
      subtotal: 'المجموع قبل الضريبة',
      vat: 'ضريبة القيمة المضافة (15%)',
      total: 'الإجمالي',
      sar: 'ريال',
      payment: 'الدفع',
      cash: 'نقدًا',
      card: 'بطاقة',
      phoneLabel: 'رقم هاتف العميل (اختياري)',
      phoneHint: 'يسجل العميل في برنامج الولاء ويتيح له تتبع الطلب.',
      phonePlaceholder: '05XXXXXXXX',
      submit: 'إتمام الطلب',
      submitting: 'جارٍ إتمام الطلب...',
      newOrder: 'طلب جديد',
      confirmedTitle: 'تم إنشاء الطلب',
      orderNo: 'رقم الطلب',
      loadingMenu: 'جارٍ تحميل القائمة...',
      temperature: 'درجة المشروب',
      hot: 'ساخن',
      iced: 'بارد',
    },
  } as const;

  const text = content[language];

  useEffect(() => {
    let ignore = false;
    const loadMenu = async () => {
      setLoadingMenu(true);
      try {
        const urls = getApiRequestUrls('/menu/items');
        let data: any = null;
        for (const url of urls) {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            const json = await res.json();
            if (res.ok && json?.success) {
              data = json;
              break;
            }
          } catch {
            // try next fallback url
          }
        }
        if (ignore || !data) return;
        const nextCategories: Category[] = Array.isArray(data.categories)
          ? [...data.categories]
              .map((c: any) => ({
                id: String(c?.id || ''),
                nameEn: String(c?.nameEn || ''),
                nameAr: String(c?.nameAr || ''),
                order: Number(c?.order || 0),
              }))
              .filter((c: Category) => c.id)
              .sort((a: Category, b: Category) => a.order - b.order)
          : [];
        const nextItems: MenuItem[] = Array.isArray(data.items)
          ? data.items.map((i: any) => ({
              promotion: i.promotion,
              id: String(i?.id || ''),
              nameEn: String(i?.nameEn || ''),
              nameAr: String(i?.nameAr || ''),
              price: Number(i?.price || 0),
              category: String(i?.category || ''),
              available: Boolean(i?.available ?? true),
              imageUrl: i?.imageUrl || null,
            }))
          : [];
        setCategories(nextCategories);
        setMenuItems(nextItems);
        setActiveCategory((prev) => prev || nextCategories[0]?.id || '');
      } finally {
        if (!ignore) setLoadingMenu(false);
      }
    };
    void loadMenu();
    return () => {
      ignore = true;
    };
  }, []);

  const itemsTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cart]
  );

  useEffect(() => {
    if (cart.length === 0) {
      setPricing(null);
      return;
    }
    let ignore = false;
    const previewUrls = getApiRequestUrls('/orders/price-preview');
    const loadPreview = async () => {
      for (const url of previewUrls) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: cart.map((line) => ({
                id: line.id,
                quantity: line.quantity,
                selections: line.selections,
              options: line.temperature ? { temperature: line.temperature } : undefined,
              })),
              language,
            }),
          });
          const data = await res.json();
          if (res.ok && data?.success) {
            if (!ignore) setPricing(data.pricing);
            return;
          }
        } catch {
          // try next fallback url
        }
      }
      if (!ignore) {
        const vatAmount = itemsTotal * (vatRate / (1 + vatRate));
        setPricing({
          subtotalExclVat: itemsTotal - vatAmount,
          vatAmount,
          totalWithVat: itemsTotal,
        });
      }
    };
    void loadPreview();
    return () => {
      ignore = true;
    };
  }, [cart, itemsTotal, language]);

  const hasTemperatureChoice = (item: MenuItem) => !item.promotion && item.category.toLowerCase() === 'v60';

  const getSelectedTemperature = (item: MenuItem): DrinkTemperature =>
    selectedTemperatures[item.id] || 'iced';

  const getCartKey = (itemId: string, temperature?: DrinkTemperature) =>
    temperature ? `${itemId}:${temperature}` : itemId;

  const getTemperatureLabel = (temperature?: DrinkTemperature) => {
    if (!temperature) return '';
    return temperature === 'hot' ? text.hot : text.iced;
  };

  const addToCart = (item: MenuItem) => {
    if (item.promotion) { setPromoItem(item); return; }
    const temperature = hasTemperatureChoice(item) ? getSelectedTemperature(item) : undefined;
    const cartKey = getCartKey(item.id, temperature);
    setCart((prev) => {
      const existing = prev.find((line) => line.cartKey === cartKey);
      if (existing) {
        return prev.map((line) =>
          line.cartKey === cartKey ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          id: item.id,
          cartKey,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          price: item.price,
          quantity: 1,
          temperature,
        },
      ];
    });
  };

  const changeQuantity = (cartKey: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => (line.cartKey === cartKey ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const visibleItems = menuItems.filter(
    (item) => item.available && (!activeCategory || item.category === activeCategory)
  );

  const resetForNewOrder = () => {
    setCart([]);
    setCustomerPhone('');
    setPaymentMethod('cash');
    setPricing(null);
    setError('');
    setConfirmation(null);
  };

  const submitOrder = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const urls = getApiRequestUrls('/cashier/orders/create');
      let response: Response | null = null;
      let data: any = null;
      let lastError: Error | null = null;
      for (const url of urls) {
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({
              items: cart.map((line) => ({
                id: line.id,
                quantity: line.quantity,
                selections: line.selections,
              options: line.temperature ? { temperature: line.temperature } : undefined,
              })),
              paymentMethod,
              customerPhoneNumber: customerPhone.trim() || undefined,
              language,
            }),
          });
          data = await response.json().catch(() => ({}));
          break;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error('Request failed');
        }
      }
      if (!response) throw lastError || new Error('Request failed');
      if (!response.ok) throw new Error(data?.error || 'Failed to place order');

      setConfirmation({
        orderNumber: data.orderNumber || data.order?.orderNumber || '',
        displayNumber: data.displayNumber ?? data.order?.displayNumber ?? 0,
      });
      setCart([]);
      setCustomerPhone('');
      setPricing(null);
    } catch (e: any) {
      setError(e.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {promoItem && <PromotionPicker item={promoItem} items={menuItems} language={language} initialSelections={cart.find(i => i.cartKey === editingPromoKey)?.selections} onClose={() => { setPromoItem(null); setEditingPromoKey(null); }} onAdd={selections => {
        const cartKey = promoKey(promoItem.id, selections);
        setCart(prev => { const quantity = prev.find(i => i.cartKey === editingPromoKey)?.quantity || 1; const remaining = prev.filter(i => i.cartKey !== editingPromoKey); const existing = remaining.find(i => i.cartKey === cartKey); return existing ? remaining.map(i => i.cartKey === cartKey ? { ...i, quantity: i.quantity + quantity } : i) : [...remaining, { ...promoItem, selections, cartKey, quantity }]; });
        setEditingPromoKey(null);
        setPromoItem(null);
      }} />}
      <div className="sticky top-0 bg-[var(--crisp-white)] border-b-2 border-[var(--matte-black)] z-10 p-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg text-[var(--matte-black)]">{text.title}</h1>
          <div className="text-xs text-[var(--matte-black)] opacity-60">
            {text.signedInAs}: {cashierUser.name}
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-1 text-sm text-[var(--matte-black)] hover:text-[var(--espresso-brown)]"
        >
          <LogOut size={16} />
          {text.signOut}
        </button>
      </div>

      {confirmation ? (
        <div className="max-w-md mx-auto p-6 text-center">
          <div className="border-2 border-[var(--matte-black)] p-6 bg-[var(--cool-gray)]">
            <h2 className="text-xl text-[var(--matte-black)] mb-2">{text.confirmedTitle}</h2>
            <div className="text-3xl text-[var(--matte-black)] mb-1">
              #{confirmation.displayNumber}
            </div>
            <div className="text-sm text-[var(--matte-black)] opacity-70 mb-6">
              {text.orderNo} {confirmation.orderNumber}
            </div>
            <button
              onClick={resetForNewOrder}
              className="w-full py-3 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors"
            >
              {text.newOrder}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col md:flex-row">
          {/* Menu */}
          <div className="flex-1 p-4">
            {loadingMenu ? (
              <div className="text-center py-16 text-[var(--matte-black)] opacity-50">
                {text.loadingMenu}
              </div>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-3 mb-3">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3 py-2 border-2 rounded-md whitespace-nowrap shrink-0 text-sm ${
                        activeCategory === cat.id
                          ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]'
                          : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)]'
                      }`}
                    >
                      {language === 'en' ? cat.nameEn : cat.nameAr}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {visibleItems.map((item) => {
                    const itemHasTemperatureChoice = hasTemperatureChoice(item);
                    const selectedTemperature = itemHasTemperatureChoice
                      ? getSelectedTemperature(item)
                      : undefined;
                    const cartKey = getCartKey(item.id, selectedTemperature);
                    const cartLine = cart.find((line) => line.cartKey === cartKey);
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => addToCart(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') addToCart(item);
                        }}
                        className="relative text-left border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] hover:bg-[var(--cool-gray)] transition-colors overflow-hidden cursor-pointer"
                      >
                        <div className="w-full aspect-square bg-[var(--cool-gray)]">
                          <ImageWithFallback
                            src={resolveImageUrl(item.imageUrl)}
                            alt={language === 'en' ? item.nameEn : item.nameAr}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-2">
                          <div className="text-sm text-[var(--matte-black)] truncate">
                            {language === 'en' ? item.nameEn : item.nameAr}
                          </div>
                          {itemHasTemperatureChoice && (
                            <div
                              className="flex w-fit max-w-full border border-[var(--matte-black)] bg-[var(--crisp-white)] my-1"
                              role="group"
                              aria-label={text.temperature}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {(['hot', 'iced'] as DrinkTemperature[]).map((temperature) => {
                                const selected = selectedTemperature === temperature;
                                return (
                                  <button
                                    key={temperature}
                                    type="button"
                                    onClick={() =>
                                      setSelectedTemperatures((prev) => ({
                                        ...prev,
                                        [item.id]: temperature,
                                      }))
                                    }
                                    className={`min-w-[48px] px-2 py-1 text-[11px] transition-colors ${
                                      selected
                                        ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]'
                                        : 'text-[var(--matte-black)] hover:bg-[var(--cool-gray)]'
                                    }`}
                                    aria-pressed={selected}
                                  >
                                    {temperature === 'hot' ? text.hot : text.iced}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div className="text-xs text-[var(--matte-black)] opacity-70">
                            {item.price} {text.sar}
                          </div>
                        </div>
                        {cartLine && (
                          <div className="absolute top-1.5 right-1.5 rtl:right-auto rtl:left-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-xs flex items-center justify-center">
                            {cartLine.quantity}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Cart / checkout */}
          <div className="w-full md:w-[380px] md:border-l md:border-[var(--matte-black)] p-4 bg-[var(--crisp-white)]">
            <div className="flex items-center gap-2 mb-3 text-[var(--matte-black)]">
              <ShoppingBag size={18} />
              <h2 className="text-lg">{text.cart}</h2>
            </div>

            {cart.length === 0 ? (
              <div className="text-sm text-[var(--matte-black)] opacity-50 py-6 text-center">
                {text.empty}
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {cart.map((line) => (
                  <div
                    key={line.cartKey}
                    className="flex items-center gap-2 p-2 bg-[var(--cool-gray)] text-[var(--matte-black)]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {language === 'en' ? line.nameEn : line.nameAr}
                        {line.temperature && ` · ${getTemperatureLabel(line.temperature)}`}
                      </div>
                      <PromotionSummary selections={line.selections} language={language} />
                      {line.selections && <button className="text-xs underline" onClick={() => { const product = menuItems.find(i => i.id === line.id); if (product?.promotion) { setEditingPromoKey(line.cartKey); setPromoItem(product); } }}>{language === 'ar' ? 'تعديل الاختيارات' : 'Edit choices'}</button>}
                      <div className="text-xs opacity-70">
                        {line.price} {text.sar}
                      </div>
                    </div>
                    <button
                      onClick={() => changeQuantity(line.cartKey, -1)}
                      className="w-8 h-8 bg-[var(--espresso-brown)] text-[var(--crisp-white)] flex items-center justify-center"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-6 text-center">{line.quantity}</span>
                    <button
                      onClick={() => changeQuantity(line.cartKey, 1)}
                      className="w-8 h-8 bg-[var(--espresso-brown)] text-[var(--crisp-white)] flex items-center justify-center"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mb-4">
              <div className="text-sm text-[var(--matte-black)] mb-2">{text.payment}</div>
              <div className="flex gap-2">
                {(['cash', 'card'] as const).map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`flex-1 py-2 border-2 text-sm ${
                      paymentMethod === method
                        ? 'bg-[var(--matte-black)] text-[var(--crisp-white)] border-[var(--matte-black)]'
                        : 'border-[var(--matte-black)] text-[var(--matte-black)]'
                    }`}
                  >
                    {method === 'cash' ? text.cash : text.card}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm text-[var(--matte-black)] mb-1">
                {text.phoneLabel}
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder={text.phonePlaceholder}
                dir="ltr"
                className="w-full p-3 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)] text-[var(--matte-black)] focus:outline-none focus:border-[var(--espresso-brown)]"
              />
              <div className="text-xs text-[var(--matte-black)] opacity-60 mt-1">
                {text.phoneHint}
              </div>
            </div>

            {pricing && (
              <div className="bg-[var(--cool-gray)] p-3 mb-4 text-sm">
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
                <div className="flex justify-between text-[var(--matte-black)] font-bold mt-2">
                  <span>{text.total}</span>
                  <span>
                    {pricing.totalWithVat.toFixed(2)} {text.sar}
                  </span>
                </div>
              </div>
            )}

            {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

            <button
              onClick={submitOrder}
              disabled={cart.length === 0 || submitting}
              className="w-full py-3 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
            >
              {submitting ? text.submitting : text.submit}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
