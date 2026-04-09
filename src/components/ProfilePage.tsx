import { useState, useEffect } from 'react';
import { ArrowLeft, Coffee, Gift, Receipt, Sparkles } from 'lucide-react';
import { apiBaseUrl } from '../utils/api';

interface User {
  id: string;
  phoneNumber: string;
  name: string;
  role?: 'admin' | 'user';
}

interface Loyalty {
  enabled: boolean;
  points: number;
  tier: string;
  enrollmentDate: number | null;
}

interface OrderItem {
  name: string;
  price: number;
  quantity: number;
}

interface PreviousOrder {
  id: string;
  orderNumber: string;
  displayNumber?: number;
  status: 'received' | 'completed';
  paymentMethod: string;
  createdAt: number;
  items: OrderItem[];
  totalWithVat: number;
}

interface ProfilePageProps {
  onBack: () => void;
  language: 'en' | 'ar';
  user: User | null;
  sessionToken: string | null;
  onUpdateUser: (...args: [User]) => void;
  onNavigate: (...args: ['menu' | 'contact' | 'dashboard' | 'admin-login' | 'profile']) => void;
}

export function ProfilePage({
  onBack,
  language,
  user,
  sessionToken,
  onUpdateUser,
  onNavigate,
}: ProfilePageProps) {
  const [name, setName] = useState<string>(user?.name || '');
  const [saving, setSaving] = useState(false);
  // Loyalty state
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [orders, setOrders] = useState<PreviousOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const isRTL = language === 'ar';
  const isAdmin = user?.role === 'admin';

  const content = {
    en: {
      title: 'Profile',
      name: 'Name',
      phone: 'Phone',
      role: 'Role',
      admin: 'Admin',
      user: 'User',
      save: 'Save',
      goMenu: 'Go to Menu',
      goDashboard: 'Go to Dashboard',
      back: 'Back',
      saved: 'Profile updated',
      // Loyalty labels
      loyaltyTitle: 'Loyalty Rewards',
      loyaltyHint: 'Starts automatically after your first order.',
      progress: 'Progress',
      nextReward: 'Next reward',
      rewardAvailable: 'Reward available now',
      freeCup: 'Free cup (3rd order)',
      halfOff: '50% off (6th order, max 20 SAR)',
      startEarning: 'Place your first order to start collecting stamps.',
      ordersOfSix: 'orders / 6',
      stamps: 'Stamps',
      loyaltyFetchFailed: 'Failed to load loyalty',
      loyaltyUpdateFailed: 'Failed to update loyalty',
      previousOrders: 'Previous Orders',
      previousOrdersHint: 'Your recent orders appear here.',
      noOrders: 'No previous orders yet.',
      ordersLoading: 'Loading orders...',
      ordersFailed: 'Failed to load orders',
      items: 'Items',
      total: 'Total',
      status: 'Status',
      received: 'Received',
      completed: 'Completed',
      payOnPickup: 'Pay on pickup',
      orderPlaced: 'Order placed',
      sar: 'SAR',
    },
    ar: {
      title: 'الملف الشخصي',
      name: 'الاسم',
      phone: 'الجوال',
      role: 'الدور',
      admin: 'مدير',
      user: 'مستخدم',
      save: 'حفظ',
      goMenu: 'اذهب إلى القائمة',
      goDashboard: 'اذهب إلى لوحة التحكم',
      back: 'رجوع',
      saved: 'تم تحديث الملف الشخصي',
      // Loyalty labels
      loyaltyTitle: 'مكافآت الولاء',
      loyaltyHint: 'يبدأ تلقائياً بعد أول طلب.',
      progress: 'التقدم',
      nextReward: 'المكافأة القادمة',
      rewardAvailable: 'مكافأة متاحة الآن',
      freeCup: 'كوب مجاني (الطلب الثالث)',
      halfOff: 'خصم 50% (الطلب السادس، حد 20 ريال)',
      startEarning: 'اطلب أول طلب لتبدأ جمع الطوابع.',
      ordersOfSix: 'طلبات / 6',
      stamps: 'الطوابع',
      loyaltyFetchFailed: 'فشل تحميل بيانات الولاء',
      loyaltyUpdateFailed: 'فشل تحديث بيانات الولاء',
      previousOrders: 'الطلبات السابقة',
      previousOrdersHint: 'ستظهر طلباتك الأخيرة هنا.',
      noOrders: 'لا توجد طلبات سابقة بعد.',
      ordersLoading: 'جاري تحميل الطلبات...',
      ordersFailed: 'فشل تحميل الطلبات',
      items: 'العناصر',
      total: 'الإجمالي',
      status: 'الحالة',
      received: 'تم الاستلام',
      completed: 'مكتمل',
      payOnPickup: 'الدفع عند الوصول',
      orderPlaced: 'تاريخ الطلب',
      sar: 'ريال',
    },
  } as const;

  const text = content[language];

  useEffect(() => {
    setName(user?.name || '');
  }, [user?.name]);

  const saveProfile = async () => {
    if (!sessionToken || !user) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/auth/complete-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (json.success && json.user) {
        onUpdateUser(json.user);
        alert(text.saved);
      } else {
        alert(json.error || 'Failed to update');
      }
    } catch (e) {
      console.error('Profile update failed', e);
      alert('Profile update failed');
    } finally {
      setSaving(false);
    }
  };

  // Loyalty: load current account
  const loadLoyalty = async () => {
    if (!sessionToken) return;
    setLoyaltyLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/profile/loyalty`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const json = await res.json();
      if (json.success && json.loyalty) {
        const l = json.loyalty;
        setLoyalty({
          enabled: Boolean(Number(l.enabled)),
          points: Number(l.points || 0),
          tier: String(l.tier || 'basic'),
          enrollmentDate: l.enrollmentDate != null ? Number(l.enrollmentDate) : null,
        });
      } else {
        console.warn(json.error || text.loyaltyFetchFailed);
      }
    } catch (e) {
      console.error('Loyalty fetch error', e);
    } finally {
      setLoyaltyLoading(false);
    }
  };

  const loadOrders = async () => {
    if (!sessionToken) return;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/orders/my?limit=20`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || text.ordersFailed);
      }
      const nextOrders = Array.isArray(json.orders) ? json.orders : [];
      setOrders(nextOrders);
    } catch (e: any) {
      console.error('Orders fetch error', e);
      setOrdersError(e?.message || text.ordersFailed);
    } finally {
      setOrdersLoading(false);
    }
  };

  const points = Number(loyalty?.points || 0);
  const stamps = loyalty?.enabled && points > 0 ? ((points - 1) % 6) + 1 : 0;
  const rewardAvailable = stamps === 3 || stamps === 6;
  const nextTarget = stamps < 3 ? 3 : 6;
  const progressPct = Math.max(0, Math.min(100, (stamps / 6) * 100));
  const nextRewardLabel = nextTarget === 3 ? text.freeCup : text.halfOff;

  useEffect(() => {
    loadLoyalty();
  }, [sessionToken]);

  useEffect(() => {
    loadOrders();
  }, [sessionToken]);

  const formatCurrency = (value: number) => `${Number(value || 0).toFixed(2)} ${text.sar}`;
  const formatOrderDate = (value: number) =>
    new Date(value).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  const getPaymentLabel = (paymentMethod: string) =>
    paymentMethod === 'pickup' || paymentMethod === 'pay_on_pickup' || paymentMethod === 'cash'
      ? text.payOnPickup
      : paymentMethod;

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="sticky top-0 bg-[var(--crisp-white)] z-20 border-b border-[var(--matte-black)]">
        <div className="flex items-center justify-between px-3 py-1.5">
          <button
            onClick={onBack}
            aria-label={text.back}
            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
          >
            <ArrowLeft size={16} className={isRTL ? 'rotate-180' : ''} />
          </button>
          <h1 className="text-sm text-[var(--matte-black)]">{text.title}</h1>
          <div className="w-4" />
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-4">
        <div className="bg-[var(--cool-gray)] p-3 border">
          <label className="block text-xs mb-1">{text.name}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
            dir={isRTL ? 'rtl' : 'ltr'}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={saveProfile}
              disabled={saving}
              className="px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm hover:bg-[var(--matte-black)] transition-colors disabled:opacity-60"
            >
              {text.save}
            </button>
          </div>
        </div>

        <div className="bg-[var(--cool-gray)] p-3 border">
          <div className="text-xs mb-1">{text.phone}</div>
          <div className="text-sm">{user?.phoneNumber}</div>
        </div>

        {isAdmin && (
          <div className="bg-[var(--cool-gray)] p-3 border">
            <div className="text-xs mb-1">{text.role}</div>
            <div className="text-sm">{text.admin}</div>
          </div>
        )}

        {/* Loyalty section */}
        <div className="border border-[var(--matte-black)] bg-[var(--crisp-white)] overflow-hidden">
          <div
            className="relative p-4"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.08) 1px, transparent 0)',
              backgroundSize: '14px 14px',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--cool-gray)]/40 to-[var(--crisp-white)]" />
            <div className="relative">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs tracking-wide text-[var(--matte-black)] opacity-70">
                    {text.loyaltyTitle}
                  </div>
                  <div className="text-[11px] text-[var(--matte-black)] mt-1">
                    {rewardAvailable ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 border border-[var(--matte-black)] bg-white"
                          style={{ boxShadow: '3px 3px 0 rgba(0,0,0,0.18)' }}
                        >
                          <Sparkles size={14} />
                          {text.rewardAvailable}
                        </span>
                      </span>
                    ) : (
                      <span className="opacity-70">{text.loyaltyHint}</span>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--matte-black)] opacity-60">
                    {text.progress}
                  </div>
                  <div className="mt-1 font-mono text-2xl text-[var(--matte-black)] leading-none">
                    {stamps}
                    <span className="text-base opacity-60">/6</span>
                  </div>
                  <div className="text-[10px] text-[var(--matte-black)] opacity-60 mt-1">
                    {points} {language === 'en' ? 'orders' : 'طلبات'}
                  </div>
                </div>
              </div>

              {/* Stamp track */}
              <div className="mt-4" dir="ltr">
                <div className="relative">
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-[var(--matte-black)] opacity-15 rounded" />
                  <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-[var(--espresso-brown)] rounded transition-all duration-700"
                    style={{ width: `${progressPct}%` }}
                  />
                  <div className="relative flex justify-between">
                    {[1, 2, 3, 4, 5, 6].map((n) => {
                      const filled = n <= stamps;
                      const isMilestone = n === 3 || n === 6;
                      return (
                        <div key={n} className="flex flex-col items-center">
                          <div
                            className={
                              `w-10 h-10 rounded-full border-2 flex items-center justify-center transition-colors ` +
                              (filled
                                ? 'bg-[var(--espresso-brown)] text-[var(--crisp-white)] border-[var(--espresso-brown)]'
                                : 'bg-white text-[var(--matte-black)] border-[var(--matte-black)]') +
                              (isMilestone
                                ? ' shadow-[4px_4px_0_rgba(0,0,0,0.18)]'
                                : ' shadow-[2px_2px_0_rgba(0,0,0,0.14)]') +
                              (rewardAvailable && n === stamps ? ' animate-pulse' : '')
                            }
                            aria-label={`stamp-${n}`}
                          >
                            {isMilestone ? <Gift size={16} /> : <Coffee size={16} />}
                          </div>
                          <div className="mt-1 text-[10px] text-[var(--matte-black)] opacity-60">
                            {n}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Next reward */}
              <div className="mt-4 border border-[var(--matte-black)] bg-white p-3">
                {stamps === 0 ? (
                  <div className="text-xs text-[var(--matte-black)] opacity-70">
                    {text.startEarning}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-[var(--matte-black)] opacity-70">
                      {rewardAvailable ? text.rewardAvailable : text.nextReward}
                    </div>
                    <div className="text-xs text-[var(--matte-black)]">
                      <span className="font-medium">{nextRewardLabel}</span>
                    </div>
                  </div>
                )}
                <div className="mt-2 text-[10px] text-[var(--matte-black)] opacity-60">
                  {text.freeCup} · {text.halfOff}
                </div>
              </div>

              {loyaltyLoading && (
                <div className="mt-3 text-[10px] text-[var(--matte-black)] opacity-50">...</div>
              )}
            </div>
          </div>
        </div>

        <div className="border border-[var(--matte-black)] bg-[var(--crisp-white)]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--matte-black)] bg-[var(--cool-gray)]">
            <Receipt size={16} className="text-[var(--espresso-brown)]" />
            <div>
              <div className="text-sm text-[var(--matte-black)]">{text.previousOrders}</div>
              <div className="text-[11px] text-[var(--matte-black)] opacity-60">
                {text.previousOrdersHint}
              </div>
            </div>
          </div>

          <div className="p-3">
            {ordersLoading ? (
              <div className="text-sm text-[var(--matte-black)] opacity-60">
                {text.ordersLoading}
              </div>
            ) : ordersError ? (
              <div className="text-sm text-red-600">{ordersError}</div>
            ) : orders.length === 0 ? (
              <div className="text-sm text-[var(--matte-black)] opacity-60">{text.noOrders}</div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="border border-[var(--matte-black)] bg-white p-3 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-lg leading-none text-[var(--matte-black)]">
                          #{order.displayNumber ?? order.orderNumber.split('-')[1]}
                        </div>
                        <div className="mt-1 text-[10px] font-mono text-[var(--matte-black)] opacity-60">
                          {order.orderNumber}
                        </div>
                      </div>
                      <div
                        className={
                          `px-2 py-1 text-[10px] border ` +
                          (order.status === 'completed'
                            ? 'border-green-700 text-green-700 bg-green-50'
                            : 'border-[var(--espresso-brown)] text-[var(--espresso-brown)] bg-[var(--cool-gray)]')
                        }
                      >
                        {order.status === 'completed' ? text.completed : text.received}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs text-[var(--matte-black)]">
                      <div>
                        <div className="opacity-50 mb-1">{text.orderPlaced}</div>
                        <div>{formatOrderDate(order.createdAt)}</div>
                      </div>
                      <div className={isRTL ? 'text-left' : 'text-right'}>
                        <div className="opacity-50 mb-1">{text.total}</div>
                        <div className="text-[var(--espresso-brown)]">
                          {formatCurrency(order.totalWithVat)}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[var(--matte-black)] opacity-50 mb-2">
                        {text.items}
                      </div>
                      <div className="space-y-1.5">
                        {order.items.map((item, index) => (
                          <div
                            key={`${order.id}-${index}`}
                            className="flex justify-between gap-3 text-xs text-[var(--matte-black)]"
                          >
                            <span className="truncate">
                              {item.quantity}× {item.name}
                            </span>
                            <span className="shrink-0">
                              {formatCurrency(Number(item.price) * Number(item.quantity))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[var(--matte-black)] text-[11px] text-[var(--matte-black)] opacity-60">
                      {text.status}: {order.status === 'completed' ? text.completed : text.received}
                      {' · '}
                      {getPaymentLabel(order.paymentMethod)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => onNavigate('menu')}
            className="px-4 py-2 border border-[var(--matte-black)] text-sm hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)] transition-colors"
          >
            {text.goMenu}
          </button>
          {isAdmin && (
            <button
              onClick={() => onNavigate('dashboard')}
              className="px-4 py-2 border border-[var(--matte-black)] text-sm hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)] transition-colors"
            >
              {text.goDashboard}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
