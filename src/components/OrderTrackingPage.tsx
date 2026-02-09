import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { apiBaseUrl } from '../utils/supabase/info';

type Language = 'en' | 'ar';

type OrderStatus = 'received' | 'preparing' | 'ready' | 'completed';

interface OrderItem {
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  orderNumber: string;
  displayNumber?: number;
  status: OrderStatus;
  paymentMethod: string;
  createdAt: number;
  items: OrderItem[];
  totalWithVat: number;
}

interface OrderTrackingPageProps {
  onBack: () => void;
  language: Language;
  sessionToken: string;
  orderId: string;
}

export function OrderTrackingPage({
  onBack,
  language,
  sessionToken,
  orderId,
}: OrderTrackingPageProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const isRTL = language === 'ar';

  const text = {
    en: {
      title: 'Order Tracking',
      order: 'Order',
      status: 'Status',
      received: 'Received',
      preparing: 'Preparing',
      ready: 'Ready',
      completed: 'Completed',
      refresh: 'Refresh',
      total: 'Total',
      sar: 'SAR',
      notFound: 'Order not found',
      loading: 'Loading...',
      back: 'Back',
    },
    ar: {
      title: 'متابعة الطلب',
      order: 'طلب',
      status: 'الحالة',
      received: 'تم الاستلام',
      preparing: 'قيد التحضير',
      ready: 'جاهز',
      completed: 'مكتمل',
      refresh: 'تحديث',
      total: 'الإجمالي',
      sar: 'ريال',
      notFound: 'لم يتم العثور على الطلب',
      loading: 'جاري التحميل...',
      back: 'رجوع',
    },
  }[language];

  const normalized = useMemo(() => {
    const raw = decodeURIComponent(orderId);
    return raw.startsWith('order:') ? raw.slice('order:'.length) : raw;
  }, [orderId]);

  const load = useCallback(
    async ({ silent }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBaseUrl}/orders/${encodeURIComponent(normalized)}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!json.order) throw new Error(text.notFound);
        setOrder(json.order);
      } catch (e: any) {
        setError(e?.message || 'Failed to load');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [normalized, sessionToken, text.notFound]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!order) return;
    if (order.status === 'completed') return;
    const t = setInterval(() => {
      load({ silent: true });
    }, 5000);
    return () => clearInterval(t);
  }, [order, load]);

  const steps: OrderStatus[] = ['received', 'preparing', 'ready', 'completed'];
  const currentIdx = order ? steps.indexOf(order.status) : 0;

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
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
          <button
            onClick={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
            aria-label={text.refresh}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <div className="text-[var(--matte-black)] opacity-60">{text.loading}</div>
        ) : error ? (
          <div className="text-red-600 text-sm">{error}</div>
        ) : order ? (
          <>
            <div className="border-2 border-[var(--matte-black)] bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs opacity-60 text-[var(--matte-black)]">{text.order}</div>
                  <div className="font-mono text-3xl text-[var(--matte-black)] leading-none">
                    #{order.displayNumber ?? order.orderNumber.split('-')[1]}
                  </div>
                  <div className="text-[10px] font-mono opacity-60 mt-1">{order.orderNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs opacity-60 text-[var(--matte-black)]">{text.total}</div>
                  <div className="text-lg text-[var(--espresso-brown)]">
                    {Number(order.totalWithVat || 0).toFixed(2)} {text.sar}
                  </div>
                </div>
              </div>

              <div className="mt-4" dir="ltr">
                <div className="grid grid-cols-4 gap-2">
                  {steps.map((s, idx) => {
                    const done = idx <= currentIdx;
                    return (
                      <div key={s} className="text-center">
                        <div
                          className={
                            `h-2 rounded-full border border-[var(--matte-black)] ` +
                            (done
                              ? 'bg-[var(--espresso-brown)] border-[var(--espresso-brown)]'
                              : 'bg-white opacity-30')
                          }
                        />
                        <div className="mt-2 text-[10px] text-[var(--matte-black)] opacity-70">
                          {text[s]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 text-xs text-[var(--matte-black)] opacity-60">
                {new Date(order.createdAt).toLocaleString(language === 'ar' ? 'ar-SA' : 'en-US')}
              </div>
            </div>

            <div className="border border-[var(--matte-black)] bg-[var(--cool-gray)] p-4">
              <div className="text-xs text-[var(--matte-black)] opacity-70 mb-2">
                {language === 'ar' ? 'العناصر' : 'Items'}
              </div>
              <div className="space-y-2">
                {order.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-[var(--matte-black)]">
                    <span className="truncate max-w-[70%]">
                      {it.quantity}× {it.name}
                    </span>
                    <span>{(Number(it.price) * Number(it.quantity)).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
