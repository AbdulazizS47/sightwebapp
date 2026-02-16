import { useState, useEffect } from 'react';
import { ArrowLeft, RefreshCw, Plus, Edit2, X } from 'lucide-react';
import { apiBaseUrl } from '../utils/supabase/info';
import { resolveImageUrl } from '../utils/media';

interface Order {
  id: string;
  userId: string | null;
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  total: number;
  subtotalExclVat?: number;
  vatAmount?: number;
  totalWithVat: number;
  status: 'received' | 'completed';
  paymentMethod: string;
  createdAt: number;
  displayNumber?: number;
  orderNumber?: string;
  phoneNumber?: string;
}

interface HistoryDay {
  dateKey: string;
  orders: number;
  revenue: number;
  completed: number;
  lastOrderAt: number | null;
}

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
}

interface MenuItem {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  price: number;
  category: string;
  available: boolean;
  imageUrl?: string | null;
}

interface AdminPanelProps {
  onBack: () => void;
  sessionToken: string;
  language: 'en' | 'ar';
  initialTab?: 'orders' | 'menu';
  embedded?: boolean;
  limitedControl?: boolean;
  ordersMode?: 'live' | 'history';
}

type Tab = 'orders' | 'menu';

export function AdminPanel({
  onBack,
  sessionToken,
  language,
  initialTab,
  embedded,
  limitedControl,
  ordersMode,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'orders');
  const mode = ordersMode ?? 'live';
  const [orders, setOrders] = useState<Order[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showNewItem, setShowNewItem] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState({ nameEn: '', nameAr: '', order: 0 });
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    price: 0,
    category: '',
    available: true,
  });
  const [itemCategoryDraft, setItemCategoryDraft] = useState<Record<string, string>>({});

  const content = {
    en: {
      title: 'Admin Panel',
      ordersTab: 'Orders',
      menuTab: 'Menu',
      liveOrders: 'Live Orders',
      ordersHistory: 'Orders History',
      noOrders: 'No orders yet',
      orderId: 'Order',
      items: 'items',
      total: 'Total',
      sar: 'SAR',
      received: 'Received',
      preparing: 'Preparing',
      ready: 'Ready',
      completed: 'Completed',
      startPreparing: 'Start Preparing',
      markReady: 'Mark Ready',
      markCompleted: 'Complete',
      refresh: 'Refresh',
      filterAll: 'All',
      search: 'Search',
      today: 'Today',
      last7Days: 'Last 7 days',
      allTime: 'All time',
      payment: 'Payment',
      customer: 'Customer',
      categories: 'Categories',
      addCategory: 'Add Category',
      addItem: 'Add Item',
      nameEn: 'Name (EN)',
      nameAr: 'Name (AR)',
      descEn: 'Description (EN)',
      descAr: 'Description (AR)',
      price: 'Price',
      category: 'Category',
      available: 'Available',
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      order: 'Order',
      image: 'Image',
      uploadImage: 'Upload Image',
      selectCategory: 'Select Category',
    },
    ar: {
      title: 'لوحة الإدارة',
      ordersTab: 'الطلبات',
      menuTab: 'القائمة',
      liveOrders: 'الطلبات المباشرة',
      ordersHistory: 'سجل الطلبات',
      noOrders: 'لا توجد طلبات',
      orderId: 'طلب',
      items: 'عناصر',
      total: 'الإجمالي',
      sar: 'ريال',
      received: 'تم الاستلام',
      preparing: 'قيد التحضير',
      ready: 'جاهز',
      completed: 'مكتمل',
      startPreparing: 'بدء التحضير',
      markReady: 'وضع علامة جاهز',
      markCompleted: 'إكمال',
      refresh: 'تحديث',
      filterAll: 'الكل',
      search: 'بحث',
      today: 'اليوم',
      last7Days: 'آخر 7 أيام',
      allTime: 'كل الوقت',
      payment: 'الدفع',
      customer: 'العميل',
      categories: 'الفئات',
      addCategory: 'إضافة فئة',
      addItem: 'إضافة عنصر',
      nameEn: 'الاسم (EN)',
      nameAr: 'الاسم (AR)',
      descEn: 'الوصف (EN)',
      descAr: 'الوصف (AR)',
      price: 'السعر',
      category: 'الفئة',
      available: 'متاح',
      save: 'حفظ',
      cancel: 'إلغاء',
      edit: 'تعديل',
      order: 'الترتيب',
      image: 'الصورة',
      uploadImage: 'رفع صورة',
      selectCategory: 'اختر الفئة',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';

  const orderTitle = mode === 'history' ? text.ordersHistory : text.liveOrders;

  const [historyQuery, setHistoryQuery] = useState('');
  const [historyRange, setHistoryRange] = useState<'today' | '7d' | 'all'>('all');
  const [historyDays, setHistoryDays] = useState<HistoryDay[]>([]);
  const [selectedDateKey, setSelectedDateKey] = useState<string>('');

  const formatDateKey = (dateKey: string) => {
    if (!/^\d{8}$/.test(dateKey)) return dateKey;
    const y = Number(dateKey.slice(0, 4));
    const m = Number(dateKey.slice(4, 6)) - 1;
    const d = Number(dateKey.slice(6, 8));
    const dt = new Date(y, m, d);
    return dt.toLocaleDateString(language === 'ar' ? 'ar-SA' : 'en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  };

  const dateKeyToRange = (dateKey: string) => {
    if (!/^\d{8}$/.test(dateKey)) return { from: 0, to: 0 };
    const y = Number(dateKey.slice(0, 4));
    const m = Number(dateKey.slice(4, 6)) - 1;
    const d = Number(dateKey.slice(6, 8));
    const from = new Date(y, m, d, 0, 0, 0, 0).getTime();
    const to = new Date(y, m, d, 23, 59, 59, 999).getTime();
    return { from, to };
  };

  useEffect(() => {
    if (activeTab === 'orders') {
      if (mode === 'history') {
        loadHistoryDays();
      }
      loadOrders();
    } else {
      loadMenu();
    }
  }, [activeTab, mode]);

  useEffect(() => {
    if (activeTab !== 'orders' || mode !== 'history') return;
    const t = setTimeout(() => {
      loadHistoryDays();
    }, 400);
    return () => clearTimeout(t);
  }, [historyQuery, historyRange, activeTab, mode]);

  useEffect(() => {
    if (activeTab !== 'orders' || mode !== 'history') return;
    if (!selectedDateKey) return;
    loadOrders();
  }, [selectedDateKey, activeTab, mode]);

  useEffect(() => {
    if (activeTab !== 'orders' || mode !== 'live') return;
    const t = setInterval(() => {
      loadOrders({ silent: true });
    }, 10000);
    return () => clearInterval(t);
  }, [activeTab, mode]);

  const loadOrders = async ({ silent }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const endpoint = mode === 'history' ? 'history' : 'active';

      let url = `${apiBaseUrl}/admin/orders/${endpoint}`;
      if (mode === 'history') {
        const now = Date.now();
        const defaultFrom =
          historyRange === 'today'
            ? new Date().setHours(0, 0, 0, 0)
            : historyRange === '7d'
              ? now - 7 * 24 * 60 * 60 * 1000
              : 0;
        const range = selectedDateKey
          ? dateKeyToRange(selectedDateKey)
          : { from: defaultFrom, to: 0 };
      const params = new URLSearchParams();
      params.set('limit', '200');
      params.set('status', 'all');
      if (range.from) params.set('from', String(range.from));
      if (range.to) params.set('to', String(range.to));
      const q = historyQuery.trim();
      if (q) params.set('q', q);
      url = `${url}?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setOrders(data.orders.sort((a: Order, b: Order) => b.createdAt - a.createdAt));
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadHistoryDays = async () => {
    if (mode !== 'history') return;
    try {
      const now = Date.now();
      const from =
        historyRange === 'today'
          ? new Date().setHours(0, 0, 0, 0)
          : historyRange === '7d'
            ? now - 7 * 24 * 60 * 60 * 1000
            : 0;

      const params = new URLSearchParams();
      params.set('limit', '120');
      params.set('status', 'all');
      if (from) params.set('from', String(from));
      const q = historyQuery.trim();
      if (q) params.set('q', q);

      const res = await fetch(`${apiBaseUrl}/admin/orders/history/days?${params.toString()}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const json = await res.json();
      if (json.success) {
        const days: HistoryDay[] = Array.isArray(json.days) ? json.days : [];
        setHistoryDays(days);
        if (days.length > 0) {
          setSelectedDateKey((prev) =>
            prev && days.some((d) => d.dateKey === prev) ? prev : days[0].dateKey
          );
        } else {
          setSelectedDateKey('');
        }
      }
    } catch (e) {
      console.error('Failed to load history days', e);
    }
  };

  const updateOrderStatus = async (orderId: string, status: Order['status']) => {
    setUpdating(orderId);
    try {
      const response = await fetch(
        `${apiBaseUrl}/admin/orders/${orderId.replace('order:', '')}/status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ status }),
        }
      );

      const data = await response.json();

      if (data.success) {
        setOrders((prev) =>
          prev.map((order) => (order.id === orderId ? { ...order, status } : order))
        );
      }
    } catch (error) {
      console.error('Error updating order:', error);
    } finally {
      setUpdating(null);
    }
  };

  const getNextAction = (status: Order['status']) => {
    if (status === 'completed') return null;
    return { label: text.markCompleted, nextStatus: 'completed' as const };
  };

  const liveOrders = orders
    .filter((o) => o.status !== 'completed')
    .sort((a, b) => a.createdAt - b.createdAt);

  const loadMenu = async () => {
    setLoading(true);
    try {
      console.log('Loading menu from server...');
      const response = await fetch(`${apiBaseUrl}/admin/menu`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      console.log('Menu loaded successfully:', data);

      if (data.success) {
        setCategories(data.categories || []);
        setMenuItems(
          (data.items || []).map((i: any) => ({
            ...i,
            descriptionEn: i.description ?? i.descriptionEn ?? '',
            descriptionAr: i.description ?? i.descriptionAr ?? '',
          }))
        );
      } else {
        console.error('Failed to load menu:', data.error);
        alert('Failed to load menu: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error loading menu:', error);
      alert('Error loading menu. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const addCategory = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/category`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(newCategory),
      });

      const data = await response.json();

      if (data.success) {
        setCategories((prev) => [...prev, data.category]);
        setNewCategory({ nameEn: '', nameAr: '', order: 0 });
        setShowNewCategory(false);
        try {
          localStorage.setItem('menuVersion', String(Date.now()));
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('menu-updates');
            bc.postMessage({ type: 'menu-updated', ts: Date.now() });
            bc.close();
          }
        } catch {}
      }
    } catch (error) {
      console.error('Error adding category:', error);
    } finally {
      setLoading(false);
    }
  };

  const addItem = async () => {
    setLoading(true);
    try {
      // Set category from showNewItem if available
      const itemToAdd = {
        ...newItem,
        category: newItem.category || showNewItem || '',
      };

      const response = await fetch(`${apiBaseUrl}/admin/menu/item`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          ...itemToAdd,
          description: itemToAdd.descriptionEn ?? itemToAdd.descriptionAr ?? '',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMenuItems((prev) => [
          ...prev,
          {
            ...data.item,
            descriptionEn: data.item.description ?? '',
            descriptionAr: data.item.description ?? '',
          },
        ]);
        setNewItem({
          nameEn: '',
          nameAr: '',
          descriptionEn: '',
          descriptionAr: '',
          price: 0,
          category: '',
          available: true,
        });
        setShowNewItem(null);
        try {
          localStorage.setItem('menuVersion', String(Date.now()));
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('menu-updates');
            bc.postMessage({ type: 'menu-updated', ts: Date.now() });
            bc.close();
          }
        } catch {}
      }
    } catch (error) {
      console.error('Error adding item:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateCategory = async (id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/category/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(categories.find((c) => c.id === id)),
      });

      const data = await response.json();

      if (data.success) {
        setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...data.category } : c)));
        setEditingCategory(null);
        try {
          localStorage.setItem('menuVersion', String(Date.now()));
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('menu-updates');
            bc.postMessage({ type: 'menu-updated', ts: Date.now() });
            bc.close();
          }
        } catch {}
      }
    } catch (error) {
      console.error('Error updating category:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateItem = async (
    id: string,
    patch?: Partial<MenuItem>,
    options?: { exitEdit?: boolean }
  ) => {
    setLoading(true);
    try {
      const itemToUpdate = menuItems.find((i) => i.id === id);
      const effectiveCategory = patch?.category ?? itemCategoryDraft[id] ?? itemToUpdate?.category;
      const merged = { ...itemToUpdate, ...patch, category: effectiveCategory };

      console.log('Updating item:', id, itemToUpdate);

      const response = await fetch(`${apiBaseUrl}/admin/menu/item/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          ...merged,
          description: merged?.descriptionEn ?? merged?.descriptionAr ?? '',
        }),
      });

      const data = await response.json();

      console.log('Update response:', data);

      if (data.success) {
        setMenuItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  ...data.item,
                  descriptionEn: data.item.description ?? '',
                  descriptionAr: data.item.description ?? '',
                }
              : i
          )
        );
        if (options?.exitEdit !== false) {
          setEditingItem(null);
          setItemCategoryDraft((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
        // Reload menu to ensure sync
        await loadMenu();
        try {
          localStorage.setItem('menuVersion', String(Date.now()));
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('menu-updates');
            bc.postMessage({ type: 'menu-updated', ts: Date.now() });
            bc.close();
          }
        } catch {}
      } else {
        console.error('Update failed:', data);
        alert('Failed to update item: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error updating item:', error);
      alert('Error updating item: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const deleteCategory = async (id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/category/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setCategories((prev) => prev.filter((c) => c.id !== id));
        try {
          localStorage.setItem('menuVersion', String(Date.now()));
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('menu-updates');
            bc.postMessage({ type: 'menu-updated', ts: Date.now() });
            bc.close();
          }
        } catch {}
      }
    } catch (error) {
      console.error('Error deleting category:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (id: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/item/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setMenuItems((prev) => prev.filter((i) => i.id !== id));
        try {
          localStorage.setItem('menuVersion', String(Date.now()));
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel('menu-updates');
            bc.postMessage({ type: 'menu-updated', ts: Date.now() });
            bc.close();
          }
        } catch {}
      }
    } catch (error) {
      console.error('Error deleting item:', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${apiBaseUrl}/admin/upload-image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        return data.imageUrl;
      }
      return null;
    } catch (error) {
      console.error('Error uploading image:', error);
      return null;
    }
  };

  const handleImageUpload = async (itemId: string | null, file: File) => {
    const imageUrl = await uploadImage(file);
    if (imageUrl) {
      if (itemId) {
        // Update existing item
        setMenuItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, imageUrl } : i)));
        // Persist immediately so it shows in the menu right away
        await updateItem(itemId, { imageUrl }, { exitEdit: false });
      } else {
        // Update new item
        setNewItem((prev) => ({ ...prev, imageUrl }));
      }
    }
  };

  const removeItemImage = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/menu/item/${id}/image`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setMenuItems((prev) => prev.map((i) => (i.id === id ? { ...i, imageUrl: null } : i)));
      await loadMenu();
    } catch (e) {
      console.error('Failed to remove image', e);
      alert('Failed to remove image');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      {!embedded && (
        <div className="sticky top-0 bg-[var(--crisp-white)] border-b-2 border-[var(--matte-black)] z-10">
          <div className="flex items-center justify-between p-6">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
              >
                <ArrowLeft size={24} className={isRTL ? 'rotate-180' : ''} />
              </button>
              <h1 className="text-xl text-[var(--matte-black)]">{text.title}</h1>
            </div>

            <button
              onClick={activeTab === 'orders' ? () => loadOrders() : () => loadMenu()}
              disabled={loading}
              className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
            >
              <RefreshCw size={24} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      )}
      {/* Content */}
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg text-[var(--matte-black)]">
            {activeTab === 'orders' ? orderTitle : text.menuTab}
          </h2>
          <div className="flex items-center gap-4">
            {!embedded &&
              (activeTab === 'orders' ? (
                <button
                  onClick={() => setActiveTab('menu')}
                  className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                >
                  {text.menuTab}
                </button>
              ) : (
                <button
                  onClick={() => setActiveTab('orders')}
                  className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                >
                  {text.ordersTab}
                </button>
              ))}
            {activeTab === 'menu' && !limitedControl && (
              <button
                onClick={() => setShowNewCategory(true)}
                className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
              >
                <Plus size={24} />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-[var(--matte-black)] opacity-50">Loading...</div>
        ) : activeTab === 'orders' && orders.length === 0 ? (
          <div className="text-center py-16 text-[var(--matte-black)] opacity-50">
            {text.noOrders}
          </div>
        ) : activeTab === 'orders' ? (
          <div className="space-y-4">
            {/* Orders toolbar */}
            {mode === 'live' ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)]">
                <div className="text-xs text-[var(--matte-black)] opacity-60">
                  auto-refresh 10s
                </div>
                <button
                  onClick={() => loadOrders()}
                  disabled={loading}
                  className="px-3 py-1.5 border-2 border-[var(--matte-black)] text-xs hover:bg-[var(--cool-gray)] transition-colors disabled:opacity-60"
                >
                  {text.refresh}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)]">
                <div className="flex items-center gap-2">
                  <select
                    value={selectedDateKey}
                    onChange={(e) => setSelectedDateKey(e.target.value)}
                    className="px-3 py-1.5 border-2 border-[var(--matte-black)] text-xs bg-[var(--crisp-white)] max-w-[220px]"
                    aria-label={language === 'en' ? 'Select day' : 'اختر اليوم'}
                  >
                    {historyDays.length === 0 ? (
                      <option value="">{language === 'en' ? 'No days' : 'لا توجد أيام'}</option>
                    ) : (
                      historyDays.map((d) => (
                        <option key={d.dateKey} value={d.dateKey}>
                          {formatDateKey(d.dateKey)}
                        </option>
                      ))
                    )}
                  </select>

                  <input
                    value={historyQuery}
                    onChange={(e) => setHistoryQuery(e.target.value)}
                    placeholder={language === 'en' ? 'Order # / phone' : 'رقم الطلب / الهاتف'}
                    className="px-3 py-1.5 border-2 border-[var(--matte-black)] text-xs w-56"
                  />
                  <select
                    value={historyRange}
                    onChange={(e) => setHistoryRange(e.target.value as any)}
                    className="px-3 py-1.5 border-2 border-[var(--matte-black)] text-xs bg-[var(--crisp-white)]"
                  >
                    <option value="today">{text.today}</option>
                    <option value="7d">{text.last7Days}</option>
                    <option value="all">{text.allTime}</option>
                  </select>
                </div>
                <button
                  onClick={() => {
                    loadHistoryDays();
                    loadOrders();
                  }}
                  disabled={loading}
                  className="px-3 py-1.5 border-2 border-[var(--matte-black)] text-xs hover:bg-[var(--cool-gray)] transition-colors disabled:opacity-60"
                >
                  {text.refresh}
                </button>
              </div>
            )}

            {mode === 'history' && selectedDateKey && (
              <div className="border-2 border-[var(--matte-black)] p-3 bg-[var(--crisp-white)] text-xs text-[var(--matte-black)] flex flex-wrap items-center justify-between gap-2">
                <div className="opacity-70">{formatDateKey(selectedDateKey)}</div>
                {(() => {
                  const day = historyDays.find((d) => d.dateKey === selectedDateKey);
                  if (!day) return null;
                  return (
                    <div>
                      <span className="opacity-70">
                        {language === 'en' ? 'Orders' : 'الطلبات'}:
                      </span>{' '}
                      {day.orders} ·{' '}
                      <span className="opacity-70">
                        {language === 'en' ? 'Revenue' : 'المبيعات'}:
                      </span>{' '}
                      {Number(day.revenue || 0).toFixed(2)} {text.sar}
                    </div>
                  );
                })()}
              </div>
            )}

            {mode === 'live' ? (
              <div className="space-y-4">
                {liveOrders.length === 0 ? (
                  <div className="text-xs text-[var(--matte-black)] opacity-50">
                    {language === 'en' ? 'No orders' : 'لا توجد طلبات'}
                  </div>
                ) : (
                  liveOrders.map((order) => {
                      const orderNum =
                        order.displayNumber ||
                        order.orderNumber?.split('-')[1] ||
                        order.id.replace('order:', '').slice(0, 13);
                      const nextAction = getNextAction(order.status);

                      return (
                        <div
                          key={order.id}
                          className="border-2 border-[var(--matte-black)] p-4 bg-[var(--crisp-white)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-mono text-xl text-[var(--matte-black)]">
                                #{orderNum}
                              </div>
                              <div className="text-xs text-[var(--matte-black)] opacity-60 mt-0.5">
                                {new Date(order.createdAt).toLocaleTimeString(
                                  language === 'ar' ? 'ar-SA' : 'en-US',
                                  { hour: '2-digit', minute: '2-digit', hour12: true }
                                )}
                              </div>
                              <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1">
                                {text.customer}: {order.phoneNumber || order.userId || '-'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-[var(--matte-black)]">
                                {order.totalWithVat.toFixed(2)} {text.sar}
                              </div>
                              <div className="text-xs text-[var(--matte-black)] opacity-60">
                                {order.paymentMethod}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 space-y-1">
                            {order.items.slice(0, 4).map((item, idx) => {
                              const qty = Number(item.quantity) || 0;
                              const price = Number(item.price) || 0;
                              const lineTotal = qty * price;
                              return (
                                <div
                                  key={idx}
                                  className="flex justify-between text-xs text-[var(--matte-black)]"
                                >
                                  <span className="truncate max-w-[70%]">
                                    {qty}x {item.name}
                                  </span>
                                  <span>
                                    {Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : '0.00'}
                                  </span>
                                </div>
                              );
                            })}
                            {order.items.length > 4 && (
                              <div className="text-[10px] text-[var(--matte-black)] opacity-60">
                                +{order.items.length - 4} more
                              </div>
                            )}
                          </div>

                          {nextAction && (
                            <button
                              onClick={() => updateOrderStatus(order.id, nextAction.nextStatus)}
                              disabled={updating === order.id}
                              className="w-full mt-3 py-2 px-4 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50 text-sm"
                            >
                              {updating === order.id ? '...' : nextAction.label}
                            </button>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            ) : orders.length === 0 ? (
              <div className="text-xs text-[var(--matte-black)] opacity-60">
                {text.noOrders}
              </div>
            ) : (
              orders.map((order) => {
                // Use displayNumber for simple order number (1, 2, 3...) or orderNumber for full format (20241220-001)
                const orderNum =
                  order.displayNumber ||
                  order.orderNumber?.split('-')[1] ||
                  order.id.replace('order:', '').slice(0, 13);

                return (
                  <div
                    key={order.id}
                    className="border-2 border-[var(--matte-black)] p-6 bg-[var(--crisp-white)]"
                  >
                      {/* Order Header */}
                      <div className="flex items-start justify-between mb-4 pb-4 border-b border-[var(--matte-black)]">
                        <div>
                          <div className="text-sm opacity-70 text-[var(--matte-black)] mb-1">
                            {text.orderId}
                          </div>
                          <div className="font-mono text-2xl text-[var(--matte-black)]">
                            #{orderNum}
                          </div>
                          <div className="text-xs opacity-50 text-[var(--matte-black)] mt-1">
                            {new Date(order.createdAt).toLocaleTimeString(
                              language === 'ar' ? 'ar-SA' : 'en-US',
                              {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true,
                              }
                            )}
                          </div>
                          <div className="text-xs text-[var(--matte-black)] mt-2 opacity-70">
                            {text.customer}: {order.phoneNumber || order.userId}
                          </div>
                        </div>

                        <div className="text-sm text-[var(--matte-black)]">
                          {text.orders}
                        </div>
                      </div>

                      {/* Order Items */}
                      <div className="mb-4 space-y-2">
                        {order.items.map((item, idx) =>
                          (() => {
                            const qty = Number(item.quantity) || 0;
                            const price = Number(item.price) || 0;
                            const lineTotal = qty * price;
                            return (
                              <div
                                key={idx}
                                className="flex justify-between text-sm text-[var(--matte-black)]"
                              >
                                <span>
                                  {qty}x {item.name}
                                </span>
                                <span>
                                  {Number.isFinite(lineTotal) ? lineTotal.toFixed(2) : '0.00'}{' '}
                                  {text.sar}
                                </span>
                              </div>
                            );
                          })()
                        )}
                      </div>

                      {/* Order Footer */}
                      <div className="flex items-center justify-between pt-4 border-t border-[var(--matte-black)]">
                        <div className="text-sm text-[var(--matte-black)] opacity-70">
                          {text.payment}: {order.paymentMethod}
                        </div>
                        <div className="text-[var(--matte-black)]">
                          {text.total}: {order.totalWithVat.toFixed(2)} {text.sar}
                        </div>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        ) : activeTab === 'menu' ? (
          <div className="space-y-4">
            {showNewCategory && (
              <div className="border-2 border-[var(--matte-black)] p-6 bg-[var(--crisp-white)]">
                <h3 className="text-lg text-[var(--matte-black)] mb-4">{text.addCategory}</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-[var(--matte-black)] opacity-70">
                      {text.nameEn}
                    </label>
                    <input
                      type="text"
                      value={newCategory.nameEn}
                      onChange={(e) => setNewCategory({ ...newCategory, nameEn: e.target.value })}
                      className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-[var(--matte-black)] opacity-70">
                      {text.nameAr}
                    </label>
                    <input
                      type="text"
                      value={newCategory.nameAr}
                      onChange={(e) => setNewCategory({ ...newCategory, nameAr: e.target.value })}
                      className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-[var(--matte-black)] opacity-70">
                      {text.order}
                    </label>
                    <input
                      type="number"
                      value={newCategory.order}
                      onChange={(e) =>
                        setNewCategory({ ...newCategory, order: parseInt(e.target.value) })
                      }
                      className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end mt-4">
                  <button
                    onClick={addCategory}
                    disabled={loading}
                    className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
                  >
                    {text.save}
                  </button>
                  <button
                    onClick={() => setShowNewCategory(false)}
                    className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                  >
                    {text.cancel}
                  </button>
                </div>
              </div>
            )}
            {categories.map((category) => (
              <div
                key={category.id}
                className="border-2 border-[var(--matte-black)] p-6 bg-[var(--crisp-white)]"
              >
                <h3 className="text-lg text-[var(--matte-black)] mb-4">
                  {editingCategory === category.id ? (
                    <div className="flex items-center gap-4">
                      <input
                        type="text"
                        value={category.nameEn}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c) =>
                              c.id === category.id ? { ...c, nameEn: e.target.value } : c
                            )
                          )
                        }
                        className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                      />
                      <input
                        type="text"
                        value={category.nameAr}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c) =>
                              c.id === category.id ? { ...c, nameAr: e.target.value } : c
                            )
                          )
                        }
                        className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                      />
                      <input
                        type="number"
                        value={category.order}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c) =>
                              c.id === category.id ? { ...c, order: parseInt(e.target.value) } : c
                            )
                          )
                        }
                        className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                      />
                      <button
                        onClick={() => updateCategory(category.id)}
                        disabled={loading}
                        className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
                      >
                        {text.save}
                      </button>
                      <button
                        onClick={() => setEditingCategory(null)}
                        className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                      >
                        {text.cancel}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-[var(--matte-black)] opacity-70">
                        {text.nameEn}
                      </span>
                      <span className="text-sm text-[var(--matte-black)]">{category.nameEn}</span>
                      <span className="text-sm text-[var(--matte-black)] opacity-70">
                        {text.nameAr}
                      </span>
                      <span className="text-sm text-[var(--matte-black)]">{category.nameAr}</span>
                      <span className="text-sm text-[var(--matte-black)] opacity-70">
                        {text.order}
                      </span>
                      <span className="text-sm text-[var(--matte-black)]">{category.order}</span>
                      {!limitedControl && (
                        <>
                          <button
                            onClick={() => setEditingCategory(category.id)}
                            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                          >
                            {text.edit}
                          </button>
                          <button
                            onClick={() => deleteCategory(category.id)}
                            disabled={loading}
                            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
                          >
                            <X size={24} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </h3>
                <div className="space-y-4">
                  {menuItems
                    .filter((item) => item.category === category.id)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="border-2 border-[var(--matte-black)] p-4 bg-[var(--crisp-white)]"
                      >
                        {editingItem === item.id ? (
                          <div className="space-y-4">
                            <h4 className="text-md text-[var(--matte-black)] mb-4">Edit Item</h4>

                            {/* Image Preview and Upload */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.image}
                              </label>
                              {item.imageUrl && (
                                <div className="flex items-end gap-3">
                                  <img
                                    src={resolveImageUrl(item.imageUrl)}
                                    alt="Preview"
                                    className="w-32 h-32 object-cover border-2 border-[var(--matte-black)]"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeItemImage(item.id)}
                                    className="px-3 py-2 border-2 border-red-600 text-red-600 text-sm hover:bg-red-600 hover:text-white transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleImageUpload(item.id, file);
                                }}
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-full max-w-xs"
                              />
                            </div>

                            {/* English Name */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.nameEn}
                              </label>
                              <input
                                type="text"
                                value={item.nameEn}
                                onChange={(e) =>
                                  setMenuItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, nameEn: e.target.value } : i
                                    )
                                  )
                                }
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-full"
                              />
                            </div>

                            {/* Arabic Name */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.nameAr}
                              </label>
                              <input
                                type="text"
                                value={item.nameAr}
                                onChange={(e) =>
                                  setMenuItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, nameAr: e.target.value } : i
                                    )
                                  )
                                }
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-full"
                                dir="rtl"
                              />
                            </div>

                            {/* English Description */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.descEn}
                              </label>
                              <textarea
                                value={item.descriptionEn}
                                onChange={(e) =>
                                  setMenuItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, descriptionEn: e.target.value } : i
                                    )
                                  )
                                }
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-full"
                                rows={2}
                              />
                            </div>

                            {/* Arabic Description */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.descAr}
                              </label>
                              <textarea
                                value={item.descriptionAr}
                                onChange={(e) =>
                                  setMenuItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, descriptionAr: e.target.value } : i
                                    )
                                  )
                                }
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-full"
                                rows={2}
                                dir="rtl"
                              />
                            </div>

                            {/* Price */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.price} (SAR)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={item.price}
                                onChange={(e) =>
                                  setMenuItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id
                                        ? { ...i, price: parseFloat(e.target.value) || 0 }
                                        : i
                                    )
                                  )
                                }
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-32"
                              />
                            </div>

                            {/* Category */}
                            <div className="flex flex-col gap-2">
                              <label className="text-sm text-[var(--matte-black)] opacity-70">
                                {text.category}
                              </label>
                              <select
                                value={itemCategoryDraft[item.id] ?? item.category}
                                onChange={(e) =>
                                  setItemCategoryDraft((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)] w-full max-w-xs"
                              >
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.nameEn} / {c.nameAr}
                                  </option>
                                ))}
                              </select>
                              <div className="text-xs text-[var(--matte-black)] opacity-60">
                                Changing category here won’t move the item until you save.
                              </div>
                            </div>

                            {/* Available Toggle */}
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                id={`available-${item.id}`}
                                checked={item.available}
                                onChange={(e) =>
                                  setMenuItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, available: e.target.checked } : i
                                    )
                                  )
                                }
                                className="w-5 h-5 border-2 border-[var(--matte-black)]"
                              />
                              <label
                                htmlFor={`available-${item.id}`}
                                className="text-sm text-[var(--matte-black)]"
                              >
                                {text.available}
                              </label>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-4 pt-4">
                              <button
                                onClick={() => updateItem(item.id)}
                                disabled={loading}
                                className="py-2 px-6 bg-[var(--espresso-brown)] text-[var(--crisp-white)] hover:bg-[var(--matte-black)] transition-colors disabled:opacity-50"
                              >
                                {text.save}
                              </button>
                              <button
                                onClick={() => setEditingItem(null)}
                                className="py-2 px-6 border-2 border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] transition-colors"
                              >
                                {text.cancel}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              {item.imageUrl && (
                                <img
                                  src={resolveImageUrl(item.imageUrl)}
                                  alt={item.nameEn}
                                  className="w-24 h-24 object-cover border-2 border-[var(--matte-black)] mb-3"
                                />
                              )}
                              <div className="space-y-2">
                                <div>
                                  <span className="text-[var(--matte-black)]">{item.nameEn}</span>
                                  <span className="text-[var(--matte-black)] mx-2">/</span>
                                  <span className="text-[var(--matte-black)]" dir="rtl">
                                    {item.nameAr}
                                  </span>
                                </div>
                                <div className="text-sm text-[var(--matte-black)] opacity-70">
                                  {item.descriptionEn}
                                </div>
                                <div
                                  className="text-sm text-[var(--matte-black)] opacity-70"
                                  dir="rtl"
                                >
                                  {item.descriptionAr}
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                  <span className="text-[var(--espresso-brown)]">
                                    {item.price} SAR
                                  </span>
                                  <span
                                    className={`${item.available ? 'text-green-600' : 'text-red-600'}`}
                                  >
                                    {item.available ? '● Available' : '● Unavailable'}
                                  </span>
                                </div>
                                {limitedControl && (
                                  <div className="flex items-center gap-3 mt-2">
                                    <input
                                      type="checkbox"
                                      id={`limited-available-${item.id}`}
                                      checked={item.available}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setMenuItems((prev) =>
                                          prev.map((i) =>
                                            i.id === item.id ? { ...i, available: checked } : i
                                          )
                                        );
                                        setTimeout(() => updateItem(item.id), 0);
                                      }}
                                      className="w-5 h-5 border-2 border-[var(--matte-black)]"
                                    />
                                    <label
                                      htmlFor={`limited-available-${item.id}`}
                                      className="text-sm text-[var(--matte-black)]"
                                    >
                                      {text.available}
                                    </label>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {!limitedControl && (
                                <>
                                  <button
                                    onClick={() => setEditingItem(item.id)}
                                    className="p-2 text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                                  >
                                    <Edit2 size={18} />
                                  </button>
                                  <button
                                    onClick={() => deleteItem(item.id)}
                                    disabled={loading}
                                    className="p-2 text-[var(--matte-black)] hover:text-red-600 transition-colors disabled:opacity-50"
                                  >
                                    <X size={18} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  {!limitedControl && (
                    <button
                      onClick={() => setShowNewItem(category.id)}
                      className="w-full py-3 px-6 border-2 border-dashed border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] transition-colors flex items-center justify-center gap-2"
                    >
                      <Plus size={18} />
                      {text.addItem}
                    </button>
                  )}
                  {!limitedControl && showNewItem === category.id && (
                    <div className="border-2 border-[var(--matte-black)] p-4 bg-[var(--crisp-white)]">
                      <h4 className="text-md text-[var(--matte-black)] mb-2">{text.addItem}</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.nameEn}
                          </label>
                          <input
                            type="text"
                            value={newItem.nameEn}
                            onChange={(e) => setNewItem({ ...newItem, nameEn: e.target.value })}
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.nameAr}
                          </label>
                          <input
                            type="text"
                            value={newItem.nameAr}
                            onChange={(e) => setNewItem({ ...newItem, nameAr: e.target.value })}
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.descEn}
                          </label>
                          <input
                            type="text"
                            value={newItem.descriptionEn}
                            onChange={(e) =>
                              setNewItem({ ...newItem, descriptionEn: e.target.value })
                            }
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.descAr}
                          </label>
                          <input
                            type="text"
                            value={newItem.descriptionAr}
                            onChange={(e) =>
                              setNewItem({ ...newItem, descriptionAr: e.target.value })
                            }
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.price}
                          </label>
                          <input
                            type="number"
                            value={newItem.price}
                            onChange={(e) =>
                              setNewItem({ ...newItem, price: parseFloat(e.target.value) })
                            }
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.category}
                          </label>
                          <select
                            value={newItem.category}
                            onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          >
                            <option value="">{text.selectCategory}</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nameEn} / {c.nameAr}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.available}
                          </label>
                          <input
                            type="checkbox"
                            checked={newItem.available}
                            onChange={(e) =>
                              setNewItem({ ...newItem, available: e.target.checked })
                            }
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-sm text-[var(--matte-black)] opacity-70">
                            {text.image}
                          </label>
                          {newItem.imageUrl && (
                            <img
                              src={resolveImageUrl(newItem.imageUrl)}
                              alt="Preview"
                              className="w-32 h-32 object-cover border-2 border-[var(--matte-black)]"
                            />
                          )}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload(null, file);
                            }}
                            className="border-2 border-[var(--matte-black)] p-2 text-sm text-[var(--matte-black)]"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end mt-4">
                        <button
                          onClick={addItem}
                          disabled={loading}
                          className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors disabled:opacity-50"
                        >
                          {text.save}
                        </button>
                        <button
                          onClick={() => setShowNewItem(null)}
                          className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
                        >
                          {text.cancel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
