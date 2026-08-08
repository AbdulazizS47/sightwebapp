import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Users,
  ClipboardList,
  Utensils,
  RefreshCw,
  Package,
  UserCog,
  ShieldCheck,
} from 'lucide-react';
import { AdminPanel } from './AdminPanel';
import { AdminInventoryPanel } from './AdminInventoryPanel';
import { allowSeedMenuTools, apiBaseUrl } from '../utils/api';

interface AdminDashboardProps {
  onBack: () => void;
  sessionToken: string;
  language: 'en' | 'ar';
  isRootAdmin?: boolean;
}

type Tab =
  | 'live-orders'
  | 'history'
  | 'menu'
  | 'inventory'
  | 'customers'
  | 'staff'
  | 'admins'
  | 'settings';

interface StaffAccount {
  id: string;
  phoneNumber: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

interface AdminAccount {
  id: string;
  phoneNumber: string;
  name: string;
  active: boolean;
  isRootAdmin: boolean;
  createdAt: number;
  updatedAt: number;
}

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

export function AdminDashboard({
  onBack,
  sessionToken,
  language,
  isRootAdmin,
}: AdminDashboardProps) {
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
          tab === 'inventory' ||
          tab === 'customers' ||
          tab === 'staff' ||
          tab === 'admins' ||
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
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [pendingConvert, setPendingConvert] = useState<{ existingName: string | null } | null>(
    null
  );
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editStaffName, setEditStaffName] = useState('');
  const [savingStaffId, setSavingStaffId] = useState<string | null>(null);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminsError, setAdminsError] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminPhone, setNewAdminPhone] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [pendingAdminConvert, setPendingAdminConvert] = useState<{
    existingName: string | null;
  } | null>(null);
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [editAdminName, setEditAdminName] = useState('');
  const [savingAdminId, setSavingAdminId] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [isOpenSetting, setIsOpenSetting] = useState(true);
  const [computedOpenSetting, setComputedOpenSetting] = useState(true);
  const [hoursEnSetting, setHoursEnSetting] = useState('Daily: 4:00 PM - 2:00 AM');
  const [hoursArSetting, setHoursArSetting] = useState('يوميًا: ٤:٠٠ مساءً - ٢:٠٠ صباحًا');
  const [scheduleEnabledSetting, setScheduleEnabledSetting] = useState(true);
  const [hoursStartSetting, setHoursStartSetting] = useState('16:00');
  const [hoursEndSetting, setHoursEndSetting] = useState('02:00');
  const [timeZoneSetting, setTimeZoneSetting] = useState('Asia/Riyadh');

  const content = {
    en: {
      title: 'Admin Dashboard',
      ordersTab: 'Live Orders',
      historyTab: 'Order History',
      menuTab: 'Menu',
      inventoryTab: 'Inventory',
      customersTab: 'Customers',
      staffTab: 'Staff',
      settingsTab: 'Settings',
      staffName: 'Name',
      staffPhone: 'Phone Number',
      staffHint: 'The cashier signs in with this phone number using a normal SMS code, just like admin.',
      convertExistingPrompt: 'A customer account already uses this phone number. Convert it to a cashier account instead?',
      convertExistingConfirm: 'Convert to Cashier',
      addStaff: 'Add Cashier',
      status: 'Status',
      activeStatus: 'Active',
      inactiveStatus: 'Deactivated',
      edit: 'Edit',
      deactivate: 'Deactivate',
      activate: 'Activate',
      saveChanges: 'Save',
      cancel: 'Cancel',
      noStaff: 'No cashier accounts yet',
      staffCreated: 'Cashier account created',
      adminsTab: 'Admins',
      adminName: 'Name',
      adminPhone: 'Phone Number',
      adminHint: 'The admin signs in with this phone number using a normal SMS code.',
      addAdmin: 'Add Admin',
      noAdmins: 'No other admin accounts yet',
      rootAdminBadge: 'Primary',
      convertAdminPrompt: 'An existing account already uses this phone number. Convert it to an admin account instead?',
      convertAdminConfirm: 'Convert to Admin',
      rootAdminOnly: 'Only the primary admin can manage admin accounts.',
      refresh: 'Refresh',
      cleanupSeed: 'Remove Seed Items',
      openStatus: 'Open Status',
      currentStatus: 'Current status',
      scheduleMode: 'Open Hours Schedule',
      scheduleAuto: 'Auto (based on hours)',
      scheduleManual: 'Manual (override)',
      openNow: 'Open now',
      closed: 'Closed',
      hoursEn: 'Hours (EN)',
      hoursAr: 'Hours (AR)',
      hoursStart: 'Opens at (24h)',
      hoursEnd: 'Closes at (24h)',
      timeZone: 'Time zone',
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
      inventoryTab: 'المخزون',
      customersTab: 'العملاء',
      staffTab: 'الموظفون',
      settingsTab: 'الإعدادات',
      staffName: 'الاسم',
      staffPhone: 'رقم الهاتف',
      staffHint: 'يسجل الكاشير الدخول بهذا الرقم عبر رمز SMS عادي، تمامًا مثل المدير.',
      convertExistingPrompt: 'يوجد حساب عميل بهذا الرقم بالفعل. هل تريد تحويله إلى حساب كاشير؟',
      convertExistingConfirm: 'تحويل إلى كاشير',
      addStaff: 'إضافة كاشير',
      status: 'الحالة',
      activeStatus: 'مفعل',
      inactiveStatus: 'موقوف',
      edit: 'تعديل',
      deactivate: 'إيقاف',
      activate: 'تفعيل',
      saveChanges: 'حفظ',
      cancel: 'إلغاء',
      noStaff: 'لا يوجد حسابات كاشير بعد',
      staffCreated: 'تم إنشاء حساب الكاشير',
      adminsTab: 'المدراء',
      adminName: 'الاسم',
      adminPhone: 'رقم الهاتف',
      adminHint: 'يسجل المدير الدخول بهذا الرقم عبر رمز SMS عادي.',
      addAdmin: 'إضافة مدير',
      noAdmins: 'لا يوجد مدراء آخرون بعد',
      rootAdminBadge: 'الأساسي',
      convertAdminPrompt: 'يوجد حساب بهذا الرقم بالفعل. هل تريد تحويله إلى حساب مدير؟',
      convertAdminConfirm: 'تحويل إلى مدير',
      rootAdminOnly: 'يمكن فقط للمدير الأساسي إدارة حسابات المدراء.',
      refresh: 'تحديث',
      cleanupSeed: 'حذف العناصر الأولية',
      openStatus: 'حالة المتجر',
      currentStatus: 'الحالة الحالية',
      scheduleMode: 'جدول ساعات العمل',
      scheduleAuto: 'تلقائي حسب الساعات',
      scheduleManual: 'يدوي (تجاوز)',
      openNow: 'مفتوح الآن',
      closed: 'مغلق',
      hoursEn: 'ساعات العمل (EN)',
      hoursAr: 'ساعات العمل (AR)',
      hoursStart: 'يفتح عند (24h)',
      hoursEnd: 'يغلق عند (24h)',
      timeZone: 'المنطقة الزمنية',
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

  const loadStaff = async () => {
    setStaffLoading(true);
    setStaffError('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/staff`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setStaff(data.staff || []);
      } else {
        setStaffError(data.error || 'Failed to load staff accounts');
      }
    } catch (e) {
      console.error('Error loading staff accounts', e);
      setStaffError('Failed to load staff accounts');
    } finally {
      setStaffLoading(false);
    }
  };

  const createStaff = async (convertExisting = false) => {
    setStaffError('');
    if (!newStaffName.trim() || !newStaffPhone.trim()) return;
    setCreatingStaff(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          name: newStaffName.trim(),
          phoneNumber: newStaffPhone.trim(),
          ...(convertExisting ? { convertExisting: true } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.existingRole === 'user') {
          setPendingConvert({ existingName: data.existingName || null });
        } else {
          setPendingConvert(null);
        }
        setStaffError(data.error || 'Failed to create staff account');
        return;
      }
      setPendingConvert(null);
      setNewStaffName('');
      setNewStaffPhone('');
      await loadStaff();
    } catch (e) {
      console.error('Error creating staff account', e);
      setStaffError('Failed to create staff account');
    } finally {
      setCreatingStaff(false);
    }
  };

  const startEditStaff = (member: StaffAccount) => {
    setEditingStaffId(member.id);
    setEditStaffName(member.name);
    setStaffError('');
  };

  const saveStaffEdits = async (id: string) => {
    setSavingStaffId(id);
    setStaffError('');
    try {
      const payload: Record<string, unknown> = { name: editStaffName.trim() };
      const res = await fetch(`${apiBaseUrl}/admin/staff/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        setStaffError(data.error || 'Failed to update staff account');
        return;
      }
      setEditingStaffId(null);
      await loadStaff();
    } catch (e) {
      console.error('Error updating staff account', e);
      setStaffError('Failed to update staff account');
    } finally {
      setSavingStaffId(null);
    }
  };

  const toggleStaffActive = async (member: StaffAccount) => {
    setSavingStaffId(member.id);
    setStaffError('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/staff/${member.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ active: !member.active }),
      });
      const data = await res.json();
      if (!data.success) {
        setStaffError(data.error || 'Failed to update staff account');
        return;
      }
      await loadStaff();
    } catch (e) {
      console.error('Error updating staff account', e);
      setStaffError('Failed to update staff account');
    } finally {
      setSavingStaffId(null);
    }
  };

  const loadAdmins = async () => {
    setAdminsLoading(true);
    setAdminsError('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/admins`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setAdmins(data.admins || []);
      } else {
        setAdminsError(data.error || 'Failed to load admin accounts');
      }
    } catch (e) {
      console.error('Error loading admin accounts', e);
      setAdminsError('Failed to load admin accounts');
    } finally {
      setAdminsLoading(false);
    }
  };

  const createAdmin = async (convertExisting = false) => {
    setAdminsError('');
    if (!newAdminName.trim() || !newAdminPhone.trim()) return;
    setCreatingAdmin(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/admins`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          name: newAdminName.trim(),
          phoneNumber: newAdminPhone.trim(),
          ...(convertExisting ? { convertExisting: true } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.existingRole) {
          setPendingAdminConvert({ existingName: data.existingName || null });
        } else {
          setPendingAdminConvert(null);
        }
        setAdminsError(data.error || 'Failed to create admin account');
        return;
      }
      setPendingAdminConvert(null);
      setNewAdminName('');
      setNewAdminPhone('');
      await loadAdmins();
    } catch (e) {
      console.error('Error creating admin account', e);
      setAdminsError('Failed to create admin account');
    } finally {
      setCreatingAdmin(false);
    }
  };

  const startEditAdmin = (member: AdminAccount) => {
    setEditingAdminId(member.id);
    setEditAdminName(member.name);
    setAdminsError('');
  };

  const saveAdminEdits = async (id: string) => {
    setSavingAdminId(id);
    setAdminsError('');
    try {
      const payload: Record<string, unknown> = { name: editAdminName.trim() };
      const res = await fetch(`${apiBaseUrl}/admin/admins/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        setAdminsError(data.error || 'Failed to update admin account');
        return;
      }
      setEditingAdminId(null);
      await loadAdmins();
    } catch (e) {
      console.error('Error updating admin account', e);
      setAdminsError('Failed to update admin account');
    } finally {
      setSavingAdminId(null);
    }
  };

  const toggleAdminActive = async (member: AdminAccount) => {
    setSavingAdminId(member.id);
    setAdminsError('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/admins/${member.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ active: !member.active }),
      });
      const data = await res.json();
      if (!data.success) {
        setAdminsError(data.error || 'Failed to update admin account');
        return;
      }
      await loadAdmins();
    } catch (e) {
      console.error('Error updating admin account', e);
      setAdminsError('Failed to update admin account');
    } finally {
      setSavingAdminId(null);
    }
  };

  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/settings/public`);
      const data = await res.json();
      if (data?.success) {
        const manualOpen =
          typeof data.manualOpen === 'boolean' ? data.manualOpen : Boolean(data.isOpen);
        setIsOpenSetting(manualOpen);
        setComputedOpenSetting(Boolean(data.isOpen));
        setHoursEnSetting(String(data?.hours?.en || ''));
        setHoursArSetting(String(data?.hours?.ar || ''));
        setScheduleEnabledSetting(
          typeof data?.schedule?.enabled === 'boolean' ? data.schedule.enabled : true
        );
        setHoursStartSetting(String(data?.schedule?.start || '16:00'));
        setHoursEndSetting(String(data?.schedule?.end || '02:00'));
        setTimeZoneSetting(String(data?.schedule?.timeZone || 'Asia/Riyadh'));
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
    if (activeTab === 'staff') {
      loadStaff();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'admins' && isRootAdmin) {
      loadAdmins();
    }
  }, [activeTab, isRootAdmin]);

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
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button
              onClick={onBack}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
              aria-label={language === 'en' ? 'Back to Home' : 'رجوع'}
            >
              <ArrowLeft size={24} className={isRTL ? 'rotate-180' : ''} />
            </button>
            <h1 className="text-lg sm:text-xl text-[var(--matte-black)]">{text.title}</h1>
          </div>
          {activeTab === 'staff' && (
            <button
              onClick={loadStaff}
              disabled={staffLoading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
              aria-label={text.refresh}
            >
              <RefreshCw size={24} className={staffLoading ? 'animate-spin' : ''} />
            </button>
          )}
          {activeTab === 'admins' && isRootAdmin && (
            <button
              onClick={loadAdmins}
              disabled={adminsLoading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
              aria-label={text.refresh}
            >
              <RefreshCw size={24} className={adminsLoading ? 'animate-spin' : ''} />
            </button>
          )}
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
          {activeTab === 'menu' && allowSeedMenuTools && (
            <button
              onClick={async () => {
                const ok = window.confirm(
                  language === 'en'
                    ? 'Remove seed items only? This will not touch your real menu.'
                    : 'هل تريد حذف العناصر الأولية فقط؟ لن يؤثر على قائمتك الحقيقية.'
                );
                if (!ok) return;
                setCleanupLoading(true);
                try {
                  const res = await fetch(`${apiBaseUrl}/admin/menu/cleanup-seed`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${sessionToken}` },
                  });
                  const data = await res.json();
                  if (data.success) {
                    alert(
                      language === 'en'
                        ? `Removed ${data.deleted || 0} seed items.`
                        : `تم حذف ${data.deleted || 0} عناصر أولية.`
                    );
                  } else {
                    alert('Failed to remove seed items: ' + (data.error || 'Unknown error'));
                  }
                } catch (e) {
                  console.error('Error removing seed items', e);
                  alert(language === 'en' ? 'Error removing seed items' : 'حدث خطأ أثناء الحذف');
                } finally {
                  setCleanupLoading(false);
                }
              }}
              disabled={cleanupLoading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50 text-xs sm:text-sm"
              aria-label={text.cleanupSeed}
            >
              {cleanupLoading ? '...' : text.cleanupSeed}
            </button>
          )}
        </div>

        {/* Quick stats */}
        {stats && (
          <div className="px-4 sm:px-6 pb-4">
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
        <div className="px-4 sm:px-6 pb-4 border-t border-[var(--matte-black)] overflow-x-auto">
          <div className="flex gap-2 min-w-max">
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'live-orders' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
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
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'history' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('history')}
          >
            <ClipboardList size={16} />
            <span>{text.historyTab}</span>
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'menu' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('menu')}
          >
            <Utensils size={16} /> {text.menuTab}
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'inventory' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('inventory')}
          >
            <Package size={16} /> {text.inventoryTab}
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'customers' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('customers')}
          >
            <Users size={16} /> {text.customersTab}
          </button>
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'staff' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('staff')}
          >
            <UserCog size={16} /> {text.staffTab}
          </button>
          {isRootAdmin && (
            <button
              className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'admins' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
              onClick={() => setTab('admins')}
            >
              <ShieldCheck size={16} /> {text.adminsTab}
            </button>
          )}
          <button
            className={`px-3 py-2 border-2 rounded-md flex items-center gap-2 whitespace-nowrap shrink-0 ${activeTab === 'settings' ? 'bg-[var(--matte-black)] text-[var(--crisp-white)]' : 'border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)]'}`}
            onClick={() => setTab('settings')}
          >
            {text.settingsTab}
          </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3 sm:p-6">
        {activeTab === 'live-orders' && (
          <AdminPanel
            onBack={onBack}
            sessionToken={sessionToken}
            language={language}
            initialTab="orders"
            embedded={true}
            limitedControl={true}
            ordersMode="live"
            onOrdersChanged={loadStats}
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
            onOrdersChanged={loadStats}
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
        {activeTab === 'inventory' && (
          <AdminInventoryPanel sessionToken={sessionToken} language={language} />
        )}
        {activeTab === 'customers' && (
          <div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-3">
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder={
                  language === 'en' ? 'Search phone / name / order #' : 'بحث: هاتف / اسم / رقم طلب'
                }
                className="px-3 py-2 border-2 border-[var(--matte-black)] text-sm w-full sm:max-w-md"
              />
              <button
                onClick={loadCustomers}
                disabled={loading}
                className="sm:ml-3 px-3 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] transition-colors disabled:opacity-60"
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
        {activeTab === 'staff' && (
          <div>
            <div className="border-2 border-[var(--matte-black)] p-4 bg-[var(--crisp-white)] mb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-[var(--matte-black)] opacity-70">
                    {text.staffName}
                  </label>
                  <input
                    value={newStaffName}
                    onChange={(e) => {
                      setNewStaffName(e.target.value);
                      setPendingConvert(null);
                    }}
                    className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--matte-black)] opacity-70">
                    {text.staffPhone}
                  </label>
                  <input
                    value={newStaffPhone}
                    onChange={(e) => {
                      setNewStaffPhone(e.target.value);
                      setPendingConvert(null);
                    }}
                    placeholder="05XXXXXXXX"
                    dir="ltr"
                    className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  />
                </div>
              </div>
              <div className="text-xs text-[var(--matte-black)] opacity-60 mt-2">{text.staffHint}</div>
              {staffError && <div className="text-red-600 text-sm mt-3">{staffError}</div>}
              {pendingConvert && (
                <div className="mt-3 p-3 border-2 border-[var(--matte-black)] bg-[var(--cool-gray)] text-sm">
                  <div className="mb-2">
                    {text.convertExistingPrompt}
                    {pendingConvert.existingName ? ` (${pendingConvert.existingName})` : ''}
                  </div>
                  <button
                    onClick={() => createStaff(true)}
                    disabled={creatingStaff}
                    className="px-3 py-1.5 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm disabled:opacity-50"
                  >
                    {creatingStaff ? '...' : text.convertExistingConfirm}
                  </button>
                </div>
              )}
              <button
                onClick={() => createStaff()}
                disabled={creatingStaff || !newStaffName.trim() || !newStaffPhone.trim()}
                className="mt-3 px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors text-sm disabled:opacity-50"
              >
                {creatingStaff ? '...' : text.addStaff}
              </button>
            </div>

            {staff.length === 0 ? (
              <div className="text-[var(--matte-black)]">{staffLoading ? '...' : text.noStaff}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-2 border-[var(--matte-black)]">
                  <thead>
                    <tr className="bg-[var(--matte-black)] text-[var(--crisp-white)]">
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.staffName}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.staffPhone}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.status}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left" />
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((member) => {
                      const isEditing = editingStaffId === member.id;
                      const isSaving = savingStaffId === member.id;
                      return (
                        <tr
                          key={member.id}
                          className="odd:bg-[var(--crisp-white)] even:bg-[#f7f7f7] align-top"
                        >
                          <td className="p-2 border-b border-[var(--matte-black)]">
                            {isEditing ? (
                              <input
                                value={editStaffName}
                                onChange={(e) => setEditStaffName(e.target.value)}
                                className="w-full px-2 py-1 border-2 border-[var(--matte-black)] text-sm"
                              />
                            ) : (
                              member.name
                            )}
                          </td>
                          <td className="p-2 border-b border-[var(--matte-black)]" dir="ltr">
                            {member.phoneNumber}
                          </td>
                          <td className="p-2 border-b border-[var(--matte-black)]">
                            {member.active ? text.activeStatus : text.inactiveStatus}
                          </td>
                          <td className="p-2 border-b border-[var(--matte-black)]">
                            {isEditing ? (
                              <div className="flex gap-2 min-w-[180px]">
                                <button
                                  onClick={() => saveStaffEdits(member.id)}
                                  disabled={isSaving || !editStaffName.trim()}
                                  className="px-3 py-1 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm disabled:opacity-50"
                                >
                                  {isSaving ? '...' : text.saveChanges}
                                </button>
                                <button
                                  onClick={() => setEditingStaffId(null)}
                                  className="px-3 py-1 border-2 border-[var(--matte-black)] text-sm"
                                >
                                  {text.cancel}
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => startEditStaff(member)}
                                  className="px-3 py-1 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)]"
                                >
                                  {text.edit}
                                </button>
                                <button
                                  onClick={() => toggleStaffActive(member)}
                                  disabled={isSaving}
                                  className="px-3 py-1 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] disabled:opacity-50"
                                >
                                  {isSaving ? '...' : member.active ? text.deactivate : text.activate}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {activeTab === 'admins' && !isRootAdmin && (
          <div className="text-[var(--matte-black)]">{text.rootAdminOnly}</div>
        )}
        {activeTab === 'admins' && isRootAdmin && (
          <div>
            <div className="border-2 border-[var(--matte-black)] p-4 bg-[var(--crisp-white)] mb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-[var(--matte-black)] opacity-70">
                    {text.adminName}
                  </label>
                  <input
                    value={newAdminName}
                    onChange={(e) => {
                      setNewAdminName(e.target.value);
                      setPendingAdminConvert(null);
                    }}
                    className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--matte-black)] opacity-70">
                    {text.adminPhone}
                  </label>
                  <input
                    value={newAdminPhone}
                    onChange={(e) => {
                      setNewAdminPhone(e.target.value);
                      setPendingAdminConvert(null);
                    }}
                    placeholder="05XXXXXXXX"
                    dir="ltr"
                    className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  />
                </div>
              </div>
              <div className="text-xs text-[var(--matte-black)] opacity-60 mt-2">{text.adminHint}</div>
              {adminsError && <div className="text-red-600 text-sm mt-3">{adminsError}</div>}
              {pendingAdminConvert && (
                <div className="mt-3 p-3 border-2 border-[var(--matte-black)] bg-[var(--cool-gray)] text-sm">
                  <div className="mb-2">
                    {text.convertAdminPrompt}
                    {pendingAdminConvert.existingName ? ` (${pendingAdminConvert.existingName})` : ''}
                  </div>
                  <button
                    onClick={() => createAdmin(true)}
                    disabled={creatingAdmin}
                    className="px-3 py-1.5 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm disabled:opacity-50"
                  >
                    {creatingAdmin ? '...' : text.convertAdminConfirm}
                  </button>
                </div>
              )}
              <button
                onClick={() => createAdmin()}
                disabled={creatingAdmin || !newAdminName.trim() || !newAdminPhone.trim()}
                className="mt-3 px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors text-sm disabled:opacity-50"
              >
                {creatingAdmin ? '...' : text.addAdmin}
              </button>
            </div>

            {admins.length === 0 ? (
              <div className="text-[var(--matte-black)]">{adminsLoading ? '...' : text.noAdmins}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-2 border-[var(--matte-black)]">
                  <thead>
                    <tr className="bg-[var(--matte-black)] text-[var(--crisp-white)]">
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.adminName}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.adminPhone}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left">
                        {text.status}
                      </th>
                      <th className="p-2 border-b-2 border-[var(--matte-black)] text-left" />
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((member) => {
                      const isEditing = editingAdminId === member.id;
                      const isSaving = savingAdminId === member.id;
                      return (
                        <tr
                          key={member.id}
                          className="odd:bg-[var(--crisp-white)] even:bg-[#f7f7f7] align-top"
                        >
                          <td className="p-2 border-b border-[var(--matte-black)]">
                            {isEditing ? (
                              <input
                                value={editAdminName}
                                onChange={(e) => setEditAdminName(e.target.value)}
                                className="w-full px-2 py-1 border-2 border-[var(--matte-black)] text-sm"
                              />
                            ) : (
                              member.name
                            )}
                          </td>
                          <td className="p-2 border-b border-[var(--matte-black)]" dir="ltr">
                            {member.phoneNumber}
                          </td>
                          <td className="p-2 border-b border-[var(--matte-black)]">
                            {member.active ? text.activeStatus : text.inactiveStatus}
                          </td>
                          <td className="p-2 border-b border-[var(--matte-black)]">
                            {member.isRootAdmin ? (
                              <span className="text-xs uppercase tracking-wider text-[var(--matte-black)] opacity-60">
                                {text.rootAdminBadge}
                              </span>
                            ) : isEditing ? (
                              <div className="flex gap-2 min-w-[180px]">
                                <button
                                  onClick={() => saveAdminEdits(member.id)}
                                  disabled={isSaving || !editAdminName.trim()}
                                  className="px-3 py-1 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm disabled:opacity-50"
                                >
                                  {isSaving ? '...' : text.saveChanges}
                                </button>
                                <button
                                  onClick={() => setEditingAdminId(null)}
                                  className="px-3 py-1 border-2 border-[var(--matte-black)] text-sm"
                                >
                                  {text.cancel}
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => startEditAdmin(member)}
                                  className="px-3 py-1 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)]"
                                >
                                  {text.edit}
                                </button>
                                <button
                                  onClick={() => toggleAdminActive(member)}
                                  disabled={isSaving}
                                  className="px-3 py-1 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] disabled:opacity-50"
                                >
                                  {isSaving ? '...' : member.active ? text.deactivate : text.activate}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
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
                  {text.scheduleMode}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scheduleEnabledSetting}
                    onChange={(e) => setScheduleEnabledSetting(e.target.checked)}
                  />
                  <span>
                    {scheduleEnabledSetting ? text.scheduleAuto : text.scheduleManual}
                  </span>
                </label>
                <div className="mt-2 text-xs text-[var(--matte-black)] opacity-60">
                  {text.currentStatus}: {computedOpenSetting ? text.openNow : text.closed}
                </div>
              </div>

              <div>
                <div className="text-sm text-[var(--matte-black)] opacity-70 mb-2">
                  {text.openStatus}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isOpenSetting}
                    onChange={(e) => setIsOpenSetting(e.target.checked)}
                    disabled={scheduleEnabledSetting}
                  />
                  <span>{isOpenSetting ? text.openNow : text.closed}</span>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-[var(--matte-black)] opacity-70">
                    {text.hoursStart}
                  </label>
                  <input
                    type="text"
                    value={hoursStartSetting}
                    onChange={(e) => setHoursStartSetting(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                    placeholder="16:00"
                  />
                </div>
                <div>
                  <label className="text-sm text-[var(--matte-black)] opacity-70">
                    {text.hoursEnd}
                  </label>
                  <input
                    type="text"
                    value={hoursEndSetting}
                    onChange={(e) => setHoursEndSetting(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                    placeholder="02:00"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-[var(--matte-black)] opacity-70">
                  {text.timeZone}
                </label>
                <input
                  type="text"
                  value={timeZoneSetting}
                  onChange={(e) => setTimeZoneSetting(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  placeholder="Asia/Riyadh"
                />
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
                          scheduleEnabled: scheduleEnabledSetting,
                          hoursStart: hoursStartSetting,
                          hoursEnd: hoursEndSetting,
                          timeZone: timeZoneSetting,
                        }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        if (typeof data.isOpen === 'boolean') {
                          setComputedOpenSetting(Boolean(data.isOpen));
                        }
                        if (typeof data.manualOpen === 'boolean') {
                          setIsOpenSetting(Boolean(data.manualOpen));
                        }
                        if (data?.schedule) {
                          if (typeof data.schedule.enabled === 'boolean') {
                            setScheduleEnabledSetting(Boolean(data.schedule.enabled));
                          }
                          if (data.schedule.start) {
                            setHoursStartSetting(String(data.schedule.start));
                          }
                          if (data.schedule.end) {
                            setHoursEndSetting(String(data.schedule.end));
                          }
                          if (data.schedule.timeZone) {
                            setTimeZoneSetting(String(data.schedule.timeZone));
                          }
                        }
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
