import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Users, ClipboardList, Utensils, RefreshCw, History } from 'lucide-react';
import { AdminPanel } from './AdminPanel';
import { apiBaseUrl } from '../utils/supabase/info';

interface AdminDashboardProps {
  onBack: () => void;
  sessionToken: string;
  language: 'en' | 'ar';
}

type Tab = 'live-orders' | 'orders-history' | 'menu' | 'customers';

interface CustomerSummary {
  customerKey?: string | null;
  phoneNumber: string | null;
  name?: string | null;
  totalOrders: number;
  lastOrderAt: number | null;
  lastOrderNumber?: string | null;
  totalSpent: number;
  loyaltyEnabled?: boolean;
  loyaltyTier?: string | null;
  loyaltyPoints?: number;
}

interface OrderStats {
  live: { total: number; received: number; preparing: number; ready: number };
  today: { dateKey: string; orders: number; completed: number; revenue: number };
}

export function AdminDashboard({ onBack, sessionToken, language }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('live-orders');

  // Read tab from hash (#/dashboard/<tab>)
  useEffect(() => {
    const applyHashTab = () => {
      const raw = window.location.hash.replace('#/', '').trim();
      const parts = raw.split('/');
      if (parts[0] === 'dashboard' && parts[1]) {
        // Backward compatibility: old routes used "orders"
        const normalized = parts[1] === 'orders' ? 'live-orders' : parts[1];
        const tab = normalized as Tab;
        if (
          tab === 'live-orders' ||
          tab === 'orders-history' ||
          tab === 'menu' ||
          tab === 'customers'
        ) {
          setActiveTab(tab);
        }
      }
    };
    applyHashTab();
    window.addEventListener('hashchange', applyHashTab);
    return () => window.removeEventListener('hashchange', applyHashTab);
  }, []);

  const setTab = (tab: Tab) => {
    setActiveTab(tab);
    // Update hash to enable deep-linking
    window.location.hash = `#/dashboard/${tab}`;
  };
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [stats, setStats] = useState<OrderStats | null>(null);

  const content = {
    en: {
      title: 'Admin Dashboard',
      ordersTab: 'Live Orders',
      historyTab: 'Order History',
      menuTab: 'Menu',
      customersTab: 'Customers',
      refresh: 'Refresh',
      seedMenu: 'Seed Menu',
      liveNow: 'Live now',
      preparing: 'Preparing',
      ready: 'Ready',
      received: 'New',
      today: 'Today',
      orders: 'Orders',
      revenue: 'Revenue',
      phone: 'Phone',
      name: 'Name',
      totalOrders: 'Total Orders',
      totalSpent: 'Total Spent',
      lastOrder: 'Last Order',
      lastOrderNo: 'Last Order #',
      search: 'Search',
      sar: 'SAR',
      noCustomers: 'No customers yet',
      loyalty: 'Loyalty',
      tier: 'Tier',
      points: 'Points',
    },
    ar: {
      title: 'لوحة التحكم',
      ordersTab: 'الطلبات المباشرة',
      historyTab: 'سجل الطلبات',
      menuTab: 'القائمة',
      customersTab: 'العملاء',
      refresh: 'تحديث',
      seedMenu: 'تهيئة القائمة',
      liveNow: 'الطلبات الآن',
      preparing: 'قيد التحضير',
      ready: 'جاهز',
      received: 'جديد',
      today: 'اليوم',
      orders: 'الطلبات',
      revenue: 'المبيعات',
      phone: 'الهاتف',
      name: 'الاسم',
      totalOrders: 'عدد الطلبات',
      totalSpent: 'إجمالي الإنفاق',
      lastOrder: 'آخر طلب',
      lastOrderNo: 'رقم آخر طلب',
      search: 'بحث',
      sar: 'ريال',
      noCustomers: 'لا يوجد عملاء بعد',
      loyalty: 'الولاء',
      tier: 'الفئة',
      points: 'النقاط',
    },
  } as const;

  const text = content[language];
  const isRTL = language === 'ar';

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/customers`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setCustomers(data.customers || []);
      } else {
        alert('Failed to load customers: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Error loading customers', e);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/admin/orders/stats`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.success) setStats(data);
    } catch {
      // ignore
    }
  };

  const seedMenu = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/reset-menu`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.success) {
        alert(language === 'en' ? 'Menu seeded successfully' : 'تم تهيئة القائمة بنجاح');
      } else {
        alert('Failed to seed menu: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Error seeding menu', e);
      alert(language === 'en' ? 'Error seeding menu' : 'حدث خطأ أثناء تهيئة القائمة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'customers') {
      loadCustomers();
    }
  }, [activeTab]);

  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 10000);
    return () => clearInterval(t);
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const phone = (c.phoneNumber || '').toLowerCase();
      const name = (c.name || '').toLowerCase();
      const lastOrderNumber = (c.lastOrderNumber || '').toLowerCase();
      return phone.includes(q) || name.includes(q) || lastOrderNumber.includes(q);
    });
  }, [customers, customerQuery]);

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="sticky top-0 bg-[var(--crisp-white)] border-b-2 border-[var(--matte-black)] z-10">
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
              aria-label={language === 'en' ? 'Back to Home' : 'رجوع'}
            >
              <ArrowLeft size={24} className={isRTL ? 'rotate-180' : ''} />
            </button>
            <h1 className="text-xl text-[var(--matte-black)]">{text.title}</h1>
          </div>
          {activeTab === 'customers' && (
            <button
              onClick={loadCustomers}
              disabled={loading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
              aria-label={text.refresh}
            >
              <RefreshCw size={24} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          {activeTab === 'menu' && (
            <button
              onClick={seedMenu}
              disabled={loading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
              aria-label={text.seedMenu}
            >
              <RefreshCw size={24} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {/* Quick stats */}
        {stats && (
          <div className="px-6 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--matte-black)] opacity-60">
                  {text.liveNow}
                </div>
                <div className="text-2xl text-[var(--matte-black)] mt-1">{stats.live.total}</div>
                <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1">
                  {text.received}: {stats.live.received} · {text.preparing}: {stats.live.preparing}{' '}
                  · {text.ready}: {stats.live.ready}
                </div>
              </div>

              <div className="border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--matte-black)] opacity-60">
                  {text.today}
                </div>
                <div className="text-2xl text-[var(--matte-black)] mt-1">{stats.today.orders}</div>
                <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1">
                  {text.orders}
                </div>
              </div>

              <div className="border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--matte-black)] opacity-60">
                  {language === 'en' ? 'Completed' : 'مكتمل'}
                </div>
                <div className="text-2xl text-[var(--matte-black)] mt-1">
                  {stats.today.completed}
                </div>
                <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1">
                  {language === 'en' ? 'Today' : 'اليوم'}
                </div>
              </div>

              <div className="border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--matte-black)] opacity-60">
                  {text.revenue}
                </div>
                <div className="text-2xl text-[var(--matte-black)] mt-1">
                  {Number(stats.today.revenue || 0).toFixed(2)}
                </div>
                <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1">{text.sar}</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6 pb-4 flex gap-2 border-t border-[var(--matte-black)]">
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 ${activeTab === 'live-orders' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('live-orders')}
          >
            <ClipboardList size={16} />
            <span>{text.ordersTab}</span>
            {stats && (
              <span className="ml-1 text-[10px] px-2 py-0.5 border border-current rounded-full">
                {stats.live.total}
              </span>
            )}
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 ${activeTab === 'orders-history' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('orders-history')}
          >
            <History size={16} /> {text.historyTab}
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 ${activeTab === 'menu' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('menu')}
          >
            <Utensils size={16} /> {text.menuTab}
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 ${activeTab === 'customers' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('customers')}
          >
            <Users size={16} /> {text.customersTab}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'live-orders' && (
          <AdminPanel
            onBack={onBack}
            sessionToken={sessionToken}
            language={language}
            initialTab="orders"
            embedded={true}
            limitedControl={true}
            ordersMode="live"
          />
        )}
        {activeTab === 'orders-history' && (
          <AdminPanel
            onBack={onBack}
            sessionToken={sessionToken}
            language={language}
            initialTab="orders"
            embedded={true}
            limitedControl={true}
            ordersMode="history"
          />
        )}
        {activeTab === 'menu' && (
          <AdminPanel
            onBack={onBack}
            sessionToken={sessionToken}
            language={language}
            initialTab="menu"
            embedded={true}
            limitedControl={true}
          />
        )}
        {activeTab === 'customers' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder={
                  language === 'en' ? 'Search phone / name / order #' : 'بحث: هاتف / اسم / رقم طلب'
                }
                className="px-3 py-2 border-2 border-[var(--matte-black)] text-sm w-full max-w-md"
              />
              <button
                onClick={loadCustomers}
                disabled={loading}
                className="ml-3 px-3 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] transition-colors disabled:opacity-60"
              >
                {text.refresh}
              </button>
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="text-[var(--matte-black)]">{text.noCustomers}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-2 border-[var(--matte-black)]">
                  <thead>
                    <tr className="bg-[var(--matte-black)] text-[var(--crisp-white)]">
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.phone}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.name}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.totalOrders}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.totalSpent} ({text.sar})
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.lastOrder}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.lastOrderNo}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.loyalty}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.tier}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.points}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((c) => (
                      <tr
                        key={c.customerKey || `${c.phoneNumber}-${c.lastOrderAt || ''}`}
                        className="odd:bg-[var(--crisp-white)] even:bg-[#f7f7f7]"
                      >
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.phoneNumber || '-'}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.name || '-'}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.totalOrders}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {Number(c.totalSpent).toFixed(2)}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleString() : '-'}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.lastOrderNumber || '-'}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.loyaltyEnabled
                            ? language === 'en'
                              ? 'Enabled'
                              : 'مفعل'
                            : language === 'en'
                              ? 'Disabled'
                              : 'غير مفعل'}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {c.loyaltyTier || '-'}
                        </td>
                        <td className="p-2 border-b border-[var(--matte-black)]">
                          {typeof c.loyaltyPoints === 'number' ? c.loyaltyPoints : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
