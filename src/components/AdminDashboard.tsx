import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Users, ClipboardList, Utensils, RefreshCw } from 'lucide-react';
import { AdminPanel } from './AdminPanel';
import { apiBaseUrl } from '../utils/supabase/info';

interface AdminDashboardProps {
  onBack: () => void;
  sessionToken: string;
  language: 'en' | 'ar';
}

type Tab = 'live-orders' | 'history' | 'menu' | 'customers' | 'settings';

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
  live: { total: number };
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
          tab === 'history' ||
          tab === 'menu' ||
          tab === 'customers' ||
          tab === 'settings'
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
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [isOpenSetting, setIsOpenSetting] = useState(true);
  const [hoursEnSetting, setHoursEnSetting] = useState('Daily: 4:00 PM - 2:00 AM');
  const [hoursArSetting, setHoursArSetting] = useState('يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا');

  const content = {
    en: {
      title: 'Admin Dashboard',
      ordersTab: 'Live Orders',
      historyTab: 'Order History',
      menuTab: 'Menu',
      customersTab: 'Customers',
      settingsTab: 'Settings',
      refresh: 'Refresh',
      cleanupDemo: 'Remove Demo Items',
      openStatus: 'Open Status',
      openNow: 'Open now',
      closed: 'Closed',
      hoursEn: 'Hours (EN)',
      hoursAr: 'Hours (AR)',
      save: 'Save',
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
      settingsTab: 'الإعدادات',
      refresh: 'تحديث',
      cleanupDemo: 'حذف العناصر التجريبية',
      openStatus: 'حالة المتجر',
      openNow: 'مفتوح الآن',
      closed: 'مغلق',
      hoursEn: 'ساعات العمل (EN)',
      hoursAr: 'ساعات العمل (AR)',
      save: 'حفظ',
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

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/settings/public`);
      const data = await res.json();
      if (data?.success) {
        setIsOpenSetting(Boolean(data.isOpen));
        setHoursEnSetting(String(data?.hours?.en || ''));
        setHoursArSetting(String(data?.hours?.ar || ''));
      }
    } catch (e) {
      console.error('Error loading settings', e);
    } finally {
      setSettingsLoading(false);
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


  useEffect(() => {
    if (activeTab === 'customers') {
      loadCustomers();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'settings') {
      loadSettings();
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
              onClick={async () => {
                const ok = window.confirm(
                  language === 'en'
                    ? 'Remove demo items only? This will not touch your real menu.'
                    : 'هل تريد حذف العناصر التجريبية فقط؟ لن يؤثر على قائمتك الحقيقية.'
                );
                if (!ok) return;
                setCleanupLoading(true);
                try {
                  const res = await fetch(`${apiBaseUrl}/admin/menu/cleanup-demo`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${sessionToken}` },
                  });
                  const data = await res.json();
                  if (data.success) {
                    alert(
                      language === 'en'
                        ? `Removed ${data.deleted || 0} demo items.`
                        : `تم حذف ${data.deleted || 0} عناصر تجريبية.`
                    );
                  } else {
                    alert('Failed to remove demo items: ' + (data.error || 'Unknown error'));
                  }
                } catch (e) {
                  console.error('Error removing demo items', e);
                  alert(language === 'en' ? 'Error removing demo items' : 'حدث خطأ أثناء الحذف');
                } finally {
                  setCleanupLoading(false);
                }
              }}
              disabled={cleanupLoading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50 text-sm"
              aria-label={text.cleanupDemo}
            >
              {cleanupLoading ? '...' : text.cleanupDemo}
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
                  {text.orders}
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
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 ${activeTab === 'history' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('history')}
          >
            <ClipboardList size={16} />
            <span>{text.historyTab}</span>
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
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 ${activeTab === 'settings' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('settings')}
          >
            {text.settingsTab}
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
        {activeTab === 'history' && (
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
        {activeTab === 'settings' && (
          <div className="max-w-xl">
            <div className="border-2 border-[var(--matte-black)] p-4 bg-[var(--crisp-white)] space-y-4">
              <div>
                <div className="text-sm text-[var(--matte-black)] opacity-70 mb-2">
                  {text.openStatus}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isOpenSetting}
                    onChange={(e) => setIsOpenSetting(e.target.checked)}
                  />
                  <span>{isOpenSetting ? text.openNow : text.closed}</span>
                </label>
              </div>

              <div>
                <label className="text-sm text-[var(--matte-black)] opacity-70">
                  {text.hoursEn}
                </label>
                <input
                  type="text"
                  value={hoursEnSetting}
                  onChange={(e) => setHoursEnSetting(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                />
              </div>

              <div>
                <label className="text-sm text-[var(--matte-black)] opacity-70">
                  {text.hoursAr}
                </label>
                <input
                  type="text"
                  value={hoursArSetting}
                  onChange={(e) => setHoursArSetting(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  dir="rtl"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    setSettingsLoading(true);
                    try {
                      const res = await fetch(`${apiBaseUrl}/admin/settings/open-status`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${sessionToken}`,
                        },
                        body: JSON.stringify({
                          isOpen: isOpenSetting,
                          hoursEn: hoursEnSetting,
                          hoursAr: hoursArSetting,
                        }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        alert(language === 'en' ? 'Settings saved' : 'تم حفظ الإعدادات');
                      } else {
                        alert('Failed to save: ' + (data.error || 'Unknown error'));
                      }
                    } catch (e) {
                      console.error('Error saving settings', e);
                      alert(language === 'en' ? 'Error saving settings' : 'حدث خطأ أثناء الحفظ');
                    } finally {
                      setSettingsLoading(false);
                    }
                  }}
                  disabled={settingsLoading}
                  className="px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors text-sm"
                >
                  {settingsLoading ? '...' : text.save}
                </button>
                <button
                  onClick={loadSettings}
                  disabled={settingsLoading}
                  className="px-4 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] transition-colors"
                >
                  {text.refresh}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
