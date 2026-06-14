import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2, Edit2, Check, X, Search, Settings2, History } from 'lucide-react';
import { apiBaseUrl } from '../utils/api';

interface AdminInventoryPanelProps {
  sessionToken: string;
  language: 'en' | 'ar';
}

type InventoryType = 'bean' | 'sweet';
type InventoryUnit = 'g' | 'pcs';

interface InventoryItemRow {
  id: string;
  nameEn: string;
  nameAr: string;
  type: InventoryType;
  unit: InventoryUnit;
  stockQty: number;
  lowStockThreshold: number;
  lowStockAlertSentAt?: number | null;
  active: boolean;
  notes: string | null;
  isLowStock: boolean;
  createdAt: number | null;
  updatedAt: number | null;
}

interface InventoryMenuItem {
  id: string;
  nameEn: string;
  nameAr: string;
  category: string | null;
  available: boolean;
}

interface InventoryRule {
  id: number;
  menuItemId: string;
  inventoryItemId: string;
  consumeQty: number;
  menuItem: InventoryMenuItem;
  inventoryItem: {
    id: string;
    nameEn: string;
    nameAr: string;
    type: InventoryType | string | null;
    unit: InventoryUnit | string | null;
    active: boolean | null;
  };
  createdAt: number | null;
  updatedAt: number | null;
}

interface InventorySummaryResponse {
  success: boolean;
  inventoryItems?: InventoryItemRow[];
  usageRules?: InventoryRule[];
  menuItems?: InventoryMenuItem[];
  unlinkedMenuItems?: InventoryMenuItem[];
  warnings?: {
    unlinkedInventoryCount?: number;
  };
  restockOptions?: {
    beanG?: number[];
  };
  error?: string;
}

interface InventoryMovement {
  id: number;
  inventoryItemId: string;
  direction: string;
  qty: number;
  reason: string;
  orderId: string | null;
  note: string | null;
  createdByUserId: string | null;
  createdByName?: string | null;
  createdAt: number | null;
}

const formatQty = (value: number, unit: InventoryUnit | string) => {
  if (unit === 'pcs') return String(Math.round(value));
  return Number(value).toFixed(Number.isInteger(value) ? 0 : 2);
};

const formatDateTime = (value: number | null, locale: string) => {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function AdminInventoryPanel({ sessionToken, language }: AdminInventoryPanelProps) {
  const isRTL = language === 'ar';
  const text = {
    en: {
      title: 'Inventory',
      subtitle: 'Track beans and sweets stock and link menu items to consumption rules.',
      refresh: 'Refresh',
      quickFilters: 'Quick Filters',
      searchItems: 'Search items by name, id, or notes',
      searchRules: 'Search rules by menu item or inventory item',
      searchPlaceholder: 'Search',
      allItems: 'All Items',
      sortBy: 'Sort By',
      filterBy: 'Filter By',
      showAll: 'Show All',
      lowOnly: 'Low Stock Only',
      activeOnly: 'Active Only',
      inactiveOnly: 'Inactive Only',
      nameAZ: 'Name A-Z',
      updatedNewest: 'Recently Updated',
      stockLowHigh: 'Stock Low-High',
      stockHighLow: 'Stock High-Low',
      thresholdHighLow: 'Threshold High-Low',
      rulesSearch: 'Rules Search',
      allCategories: 'All Categories',
      menuAZ: 'Menu A-Z',
      inventoryAZ: 'Inventory A-Z',
      recentlyChanged: 'Recently Changed',
      showing: 'Showing',
      of: 'of',
      loading: 'Loading inventory...',
      inventoryItems: 'Inventory Items',
      beans: 'Beans',
      sweets: 'Sweets',
      lowStock: 'Low Stock',
      inStock: 'In Stock',
      active: 'Active',
      inactive: 'Inactive',
      stock: 'Stock',
      threshold: 'Low Stock Threshold',
      thresholdHint: 'Telegram alert sends once when stock reaches this limit.',
      restock: 'Restock',
      manage: 'Manage',
      close: 'Close',
      stockActions: 'Stock Actions',
      adjustmentTitle: 'Manual Adjustment',
      adjustmentQty: 'Adjustment Qty',
      adjustmentHelp: 'Use a positive number to add stock or a negative number to reduce it.',
      adjustmentReason: 'Reason',
      adjustmentNote: 'Note (optional)',
      applyAdjustment: 'Apply Adjustment',
      applyingAdjustment: 'Applying...',
      reasonAdjustment: 'General Adjustment',
      reasonWaste: 'Waste / Spoilage',
      reasonCorrection: 'Count Correction',
      reasonSale: 'Sale',
      recentMovements: 'Recent Movements',
      refreshHistory: 'Refresh History',
      loadingHistory: 'Loading history...',
      noMovements: 'No movements yet',
      byUser: 'By',
      orderRef: 'Order',
      prefillRule: 'Create Rule',
      prefillRuleSuccess: 'Rule form is ready for this menu item.',
      noActiveInventoryHint: 'Add or activate an inventory item first.',
      addInventoryItem: 'Add Inventory Item',
      type: 'Type',
      bean: 'Bean',
      sweet: 'Sweet',
      nameEn: 'Name (EN)',
      nameAr: 'Name (AR)',
      notes: 'Notes (optional)',
      create: 'Create',
      creating: 'Creating...',
      customRestockQty: 'Restock Qty',
      applyRestock: 'Apply',
      rulesTitle: 'Usage Rules (Menu -> Inventory)',
      menuItem: 'Menu Item',
      inventoryItem: 'Inventory Item',
      consumeQty: 'Consume Qty / order',
      addRule: 'Add Rule',
      addingRule: 'Adding...',
      noRules: 'No usage rules yet',
      linkedRules: 'Linked Rules',
      edit: 'Edit',
      save: 'Save',
      saving: 'Saving...',
      cancel: 'Cancel',
      status: 'Status',
      delete: 'Delete',
      deleting: 'Deleting...',
      unlinkedWarningTitle: 'Unlinked Inventory Warning',
      unlinkedWarningDesc: 'Ordering is allowed, but these menu items are not reducing inventory yet.',
      noUnlinked: 'All available menu items are linked to inventory.',
      category: 'Category',
      available: 'Available',
      unavailable: 'Unavailable',
      saved: 'Saved',
      errorPrefix: 'Error',
      id: 'ID',
      noItems: 'No inventory items yet',
      createFirstHint: 'Add inventory items and usage rules to start tracking stock automatically.',
    },
    ar: {
      title: 'المخزون',
      subtitle: 'تتبع مخزون البن والحلويات وربط عناصر القائمة بقواعد الاستهلاك.',
      refresh: 'تحديث',
      quickFilters: 'فلاتر سريعة',
      searchItems: 'ابحث في العناصر بالاسم أو المعرف أو الملاحظات',
      searchRules: 'ابحث في القواعد باسم عنصر القائمة أو عنصر المخزون',
      searchPlaceholder: 'بحث',
      allItems: 'كل العناصر',
      sortBy: 'ترتيب حسب',
      filterBy: 'تصفية حسب',
      showAll: 'عرض الكل',
      lowOnly: 'المخزون المنخفض فقط',
      activeOnly: 'النشط فقط',
      inactiveOnly: 'غير النشط فقط',
      nameAZ: 'الاسم أ-ي',
      updatedNewest: 'الأحدث تحديثًا',
      stockLowHigh: 'المخزون من الأقل للأعلى',
      stockHighLow: 'المخزون من الأعلى للأقل',
      thresholdHighLow: 'الحد من الأعلى للأقل',
      rulesSearch: 'بحث القواعد',
      allCategories: 'كل الفئات',
      menuAZ: 'القائمة أ-ي',
      inventoryAZ: 'المخزون أ-ي',
      recentlyChanged: 'الأحدث تغييرًا',
      showing: 'عرض',
      of: 'من',
      loading: 'جاري تحميل المخزون...',
      inventoryItems: 'عناصر المخزون',
      beans: 'البن',
      sweets: 'الحلويات',
      lowStock: 'مخزون منخفض',
      inStock: 'متوفر',
      active: 'نشط',
      inactive: 'غير نشط',
      stock: 'المخزون',
      threshold: 'حد المخزون المنخفض',
      thresholdHint: 'يتم إرسال تنبيه تيليجرام مرة واحدة عند وصول المخزون لهذا الحد.',
      restock: 'إضافة مخزون',
      manage: 'إدارة',
      close: 'إغلاق',
      stockActions: 'إجراءات المخزون',
      adjustmentTitle: 'تعديل يدوي',
      adjustmentQty: 'كمية التعديل',
      adjustmentHelp: 'استخدم رقمًا موجبًا لإضافة مخزون أو رقمًا سالبًا لتقليله.',
      adjustmentReason: 'السبب',
      adjustmentNote: 'ملاحظة (اختياري)',
      applyAdjustment: 'تطبيق التعديل',
      applyingAdjustment: 'جارٍ التطبيق...',
      reasonAdjustment: 'تعديل عام',
      reasonWaste: 'هدر / تلف',
      reasonCorrection: 'تصحيح جرد',
      reasonSale: 'بيع',
      recentMovements: 'آخر الحركات',
      refreshHistory: 'تحديث السجل',
      loadingHistory: 'جارٍ تحميل السجل...',
      noMovements: 'لا توجد حركات بعد',
      byUser: 'بواسطة',
      orderRef: 'الطلب',
      prefillRule: 'إنشاء قاعدة',
      prefillRuleSuccess: 'تم تجهيز نموذج القاعدة لهذا العنصر.',
      noActiveInventoryHint: 'أضف أو فعّل عنصر مخزون أولًا.',
      addInventoryItem: 'إضافة عنصر مخزون',
      type: 'النوع',
      bean: 'بن',
      sweet: 'حلويات',
      nameEn: 'الاسم (EN)',
      nameAr: 'الاسم (AR)',
      notes: 'ملاحظات (اختياري)',
      create: 'إنشاء',
      creating: 'جاري الإنشاء...',
      customRestockQty: 'كمية الإضافة',
      applyRestock: 'تطبيق',
      rulesTitle: 'قواعد الاستهلاك (القائمة -> المخزون)',
      menuItem: 'عنصر القائمة',
      inventoryItem: 'عنصر المخزون',
      consumeQty: 'كمية الاستهلاك / طلب',
      addRule: 'إضافة قاعدة',
      addingRule: 'جاري الإضافة...',
      noRules: 'لا توجد قواعد استهلاك',
      linkedRules: 'القواعد المرتبطة',
      edit: 'تعديل',
      save: 'حفظ',
      saving: 'جاري الحفظ...',
      cancel: 'إلغاء',
      status: 'الحالة',
      delete: 'حذف',
      deleting: 'جاري الحذف...',
      unlinkedWarningTitle: 'تحذير عناصر غير مربوطة بالمخزون',
      unlinkedWarningDesc: 'الطلب مسموح، لكن هذه العناصر لا تخصم من المخزون بعد.',
      noUnlinked: 'جميع عناصر القائمة المتاحة مربوطة بالمخزون.',
      category: 'الفئة',
      available: 'متاح',
      unavailable: 'غير متاح',
      saved: 'تم الحفظ',
      errorPrefix: 'خطأ',
      id: 'المعرف',
      noItems: 'لا توجد عناصر مخزون بعد',
      createFirstHint: 'أضف عناصر مخزون وقواعد استهلاك لبدء التتبع التلقائي.',
    },
  } as const;

  const t = text[language];

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [submittingRule, setSubmittingRule] = useState(false);
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [adjustingItemId, setAdjustingItemId] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savingRuleId, setSavingRuleId] = useState<number | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  const [inventoryItems, setInventoryItems] = useState<InventoryItemRow[]>([]);
  const [usageRules, setUsageRules] = useState<InventoryRule[]>([]);
  const [menuItems, setMenuItems] = useState<InventoryMenuItem[]>([]);
  const [unlinkedMenuItems, setUnlinkedMenuItems] = useState<InventoryMenuItem[]>([]);
  const [beanRestockOptions, setBeanRestockOptions] = useState<number[]>([500, 1000]);

  const [newInventoryItem, setNewInventoryItem] = useState<{
    nameEn: string;
    nameAr: string;
    type: InventoryType;
    lowStockThreshold: string;
    notes: string;
  }>({
    nameEn: '',
    nameAr: '',
    type: 'bean',
    lowStockThreshold: '0',
    notes: '',
  });

  const [newRule, setNewRule] = useState<{
    menuItemId: string;
    inventoryItemId: string;
    consumeQty: string;
  }>({
    menuItemId: '',
    inventoryItemId: '',
    consumeQty: '20',
  });

  const [customRestockQtyById, setCustomRestockQtyById] = useState<Record<string, string>>({});
  const [itemSearch, setItemSearch] = useState('');
  const [itemFilter, setItemFilter] = useState<'all' | 'low' | 'active' | 'inactive'>('all');
  const [itemSort, setItemSort] = useState<'name' | 'updated' | 'stock-asc' | 'stock-desc' | 'threshold-desc'>('name');
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleCategoryFilter, setRuleCategoryFilter] = useState('all');
  const [ruleSort, setRuleSort] = useState<'menu' | 'inventory' | 'updated'>('menu');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [movementsByItemId, setMovementsByItemId] = useState<Record<string, InventoryMovement[]>>({});
  const [loadingMovementsByItemId, setLoadingMovementsByItemId] = useState<Record<string, boolean>>({});
  const [adjustmentDraftById, setAdjustmentDraftById] = useState<
    Record<string, { qtyDelta: string; reason: 'adjustment' | 'waste' | 'correction'; note: string }>
  >({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemDraft, setEditingItemDraft] = useState<{
    nameEn: string;
    nameAr: string;
    lowStockThreshold: string;
    active: boolean;
    notes: string;
  } | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editingRuleDraft, setEditingRuleDraft] = useState<{
    menuItemId: string;
    inventoryItemId: string;
    consumeQty: string;
  } | null>(null);

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    }),
    [sessionToken]
  );
  const ruleFormRef = useRef<HTMLFormElement | null>(null);

  const setFlash = (message: string) => {
    setSuccessMessage(message);
    if (message) {
      window.setTimeout(() => {
        setSuccessMessage((prev) => (prev === message ? '' : prev));
      }, 2500);
    }
  };

  const loadInventorySummary = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/inventory`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const json = (await res.json()) as InventorySummaryResponse;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to load inventory');
      }

      setInventoryItems(Array.isArray(json.inventoryItems) ? json.inventoryItems : []);
      setUsageRules(Array.isArray(json.usageRules) ? json.usageRules : []);
      setMenuItems(Array.isArray(json.menuItems) ? json.menuItems : []);
      setUnlinkedMenuItems(Array.isArray(json.unlinkedMenuItems) ? json.unlinkedMenuItems : []);
      const options = Array.isArray(json.restockOptions?.beanG)
        ? json.restockOptions?.beanG.filter((n): n is number => Number.isFinite(Number(n))).map(Number)
        : [];
      if (options.length > 0) setBeanRestockOptions(options);
    } catch (e) {
      console.error('Failed to load inventory summary', e);
      setError(e instanceof Error ? e.message : 'Failed to load inventory');
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadInventorySummary();
  }, [sessionToken]);

  const inventoryItemsById = useMemo(() => {
    const m = new Map<string, InventoryItemRow>();
    for (const item of inventoryItems) m.set(item.id, item);
    return m;
  }, [inventoryItems]);

  const availableInventoryItems = useMemo(
    () => inventoryItems.filter((item) => item.active),
    [inventoryItems]
  );
  const ruleCategories = useMemo(
    () =>
      Array.from(
        new Set(
          usageRules
            .map((rule) => rule.menuItem.category || '')
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [usageRules]
  );
  const filteredInventoryItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    const filtered = inventoryItems.filter((item) => {
      const matchesQuery =
        !query ||
        item.nameEn.toLowerCase().includes(query) ||
        item.nameAr.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query) ||
        (item.notes || '').toLowerCase().includes(query);
      const matchesFilter =
        itemFilter === 'all' ||
        (itemFilter === 'low' && item.isLowStock) ||
        (itemFilter === 'active' && item.active) ||
        (itemFilter === 'inactive' && !item.active);
      return matchesQuery && matchesFilter;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (itemSort === 'updated') return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      if (itemSort === 'stock-asc') return Number(a.stockQty || 0) - Number(b.stockQty || 0);
      if (itemSort === 'stock-desc') return Number(b.stockQty || 0) - Number(a.stockQty || 0);
      if (itemSort === 'threshold-desc') {
        return Number(b.lowStockThreshold || 0) - Number(a.lowStockThreshold || 0);
      }
      return (a.nameEn || a.nameAr).localeCompare(b.nameEn || b.nameAr, undefined, { sensitivity: 'base' });
    });
    return sorted;
  }, [inventoryItems, itemFilter, itemSearch, itemSort]);
  const filteredBeanItems = useMemo(
    () => filteredInventoryItems.filter((item) => item.type === 'bean'),
    [filteredInventoryItems]
  );
  const filteredSweetItems = useMemo(
    () => filteredInventoryItems.filter((item) => item.type === 'sweet'),
    [filteredInventoryItems]
  );
  const filteredUsageRules = useMemo(() => {
    const query = ruleSearch.trim().toLowerCase();
    const filtered = usageRules.filter((rule) => {
      const category = rule.menuItem.category || '';
      const matchesCategory = ruleCategoryFilter === 'all' || category === ruleCategoryFilter;
      const matchesQuery =
        !query ||
        rule.menuItem.nameEn.toLowerCase().includes(query) ||
        rule.menuItem.nameAr.toLowerCase().includes(query) ||
        rule.inventoryItem.nameEn.toLowerCase().includes(query) ||
        rule.inventoryItem.nameAr.toLowerCase().includes(query) ||
        category.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (ruleSort === 'updated') return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
      if (ruleSort === 'inventory') {
        return (a.inventoryItem.nameEn || a.inventoryItem.nameAr).localeCompare(
          b.inventoryItem.nameEn || b.inventoryItem.nameAr,
          undefined,
          { sensitivity: 'base' }
        );
      }
      return (a.menuItem.nameEn || a.menuItem.nameAr).localeCompare(
        b.menuItem.nameEn || b.menuItem.nameAr,
        undefined,
        { sensitivity: 'base' }
      );
    });
    return sorted;
  }, [ruleCategoryFilter, ruleSearch, ruleSort, usageRules]);

  useEffect(() => {
    if (!newRule.menuItemId && menuItems[0]) {
      setNewRule((prev) => ({ ...prev, menuItemId: menuItems[0].id }));
    }
  }, [menuItems, newRule.menuItemId]);

  useEffect(() => {
    if (!newRule.inventoryItemId && availableInventoryItems[0]) {
      const first = availableInventoryItems[0];
      setNewRule((prev) => ({
        ...prev,
        inventoryItemId: first.id,
        consumeQty: first.unit === 'pcs' ? '1' : prev.consumeQty || '20',
      }));
    }
  }, [availableInventoryItems, newRule.inventoryItemId]);

  const loadItemMovements = async (itemId: string, { force = false }: { force?: boolean } = {}) => {
    if (!force && movementsByItemId[itemId]) return;
    setLoadingMovementsByItemId((prev) => ({ ...prev, [itemId]: true }));
    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/inventory/item/${encodeURIComponent(itemId)}/movements?limit=8`,
        {
          headers: { Authorization: `Bearer ${sessionToken}` },
        }
      );
      const json = (await res.json()) as {
        success?: boolean;
        movements?: InventoryMovement[];
        error?: string;
      };
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to load inventory movements');
      }
      setMovementsByItemId((prev) => ({
        ...prev,
        [itemId]: Array.isArray(json.movements) ? json.movements : [],
      }));
    } catch (e) {
      console.error('Failed to load inventory movements', e);
      setError(e instanceof Error ? e.message : 'Failed to load inventory movements');
    } finally {
      setLoadingMovementsByItemId((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const toggleManageItem = (itemId: string) => {
    setExpandedItemId((prev) => {
      const nextId = prev === itemId ? null : itemId;
      if (nextId) {
        window.setTimeout(() => {
          loadItemMovements(itemId);
        }, 0);
      }
      return nextId;
    });
  };

  const getAdjustmentDraft = (item: InventoryItemRow) =>
    adjustmentDraftById[item.id] || {
      qtyDelta: '',
      reason: 'adjustment' as const,
      note: '',
    };

  const handlePrefillRule = (menuItemId: string) => {
    if (availableInventoryItems.length === 0) {
      setError(t.noActiveInventoryHint);
      return;
    }
    const selectedInventory =
      availableInventoryItems.find((inventoryItem) => inventoryItem.id === newRule.inventoryItemId) ||
      availableInventoryItems[0];
    setError('');
    setNewRule((prev) => ({
      ...prev,
      menuItemId,
      inventoryItemId: selectedInventory.id,
      consumeQty: selectedInventory.unit === 'pcs' ? '1' : prev.consumeQty || '20',
    }));
    setFlash(t.prefillRuleSuccess);
    window.requestAnimationFrame(() => {
      ruleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleAdjustInventory = async (item: InventoryItemRow) => {
    const draft = getAdjustmentDraft(item);
    const qtyDelta = Number(draft.qtyDelta);
    if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
      setError('qtyDelta must be a non-zero number');
      return;
    }
    if (item.unit === 'pcs' && !Number.isInteger(qtyDelta)) {
      setError('qtyDelta must be a whole number for pcs items');
      return;
    }

    setAdjustingItemId(item.id);
    setError('');
    setSuccessMessage('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/inventory/item/${encodeURIComponent(item.id)}/adjust`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          qtyDelta,
          reason: draft.reason,
          note: draft.note.trim() || null,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to adjust inventory item');
      }
      setFlash(t.saved);
      setAdjustmentDraftById((prev) => ({
        ...prev,
        [item.id]: {
          qtyDelta: '',
          reason: 'adjustment',
          note: '',
        },
      }));
      await loadInventorySummary({ silent: true });
      await loadItemMovements(item.id, { force: true });
    } catch (e) {
      console.error('Failed to adjust inventory item', e);
      setError(e instanceof Error ? e.message : 'Failed to adjust inventory item');
    } finally {
      setAdjustingItemId(null);
    }
  };

  const handleCreateInventoryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingCreate(true);
    setError('');
    setSuccessMessage('');
    try {
      const thresholdNum = Number(newInventoryItem.lowStockThreshold);
      if (!Number.isFinite(thresholdNum) || thresholdNum < 0) {
        throw new Error('lowStockThreshold must be a non-negative number');
      }
      if (newInventoryItem.type === 'sweet' && !Number.isInteger(thresholdNum)) {
        throw new Error('Sweet threshold must be a whole number');
      }

      const payload = {
        nameEn: newInventoryItem.nameEn.trim(),
        nameAr: newInventoryItem.nameAr.trim(),
        type: newInventoryItem.type,
        lowStockThreshold: thresholdNum,
        notes: newInventoryItem.notes.trim() || null,
      };

      const res = await fetch(`${apiBaseUrl}/admin/inventory/item`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to create inventory item');

      setNewInventoryItem({
        nameEn: '',
        nameAr: '',
        type: 'bean',
        lowStockThreshold: '0',
        notes: '',
      });
      setFlash(t.saved);
      await loadInventorySummary({ silent: true });
    } catch (e) {
      console.error('Failed to create inventory item', e);
      setError(e instanceof Error ? e.message : 'Failed to create inventory item');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleRestock = async (item: InventoryItemRow, qty: number) => {
    if (!Number.isFinite(qty) || qty <= 0) return;
    setRestockingId(item.id);
    setError('');
    setSuccessMessage('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/inventory/item/${encodeURIComponent(item.id)}/restock`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ qty }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to restock inventory item');
      setFlash(t.saved);
      await loadInventorySummary({ silent: true });
      await loadItemMovements(item.id, { force: true });
      if (item.unit === 'pcs') {
        setCustomRestockQtyById((prev) => ({ ...prev, [item.id]: '' }));
      }
    } catch (e) {
      console.error('Failed to restock item', e);
      setError(e instanceof Error ? e.message : 'Failed to restock item');
    } finally {
      setRestockingId(null);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRule(true);
    setError('');
    setSuccessMessage('');
    try {
      const consumeQty = Number(newRule.consumeQty);
      if (!newRule.menuItemId || !newRule.inventoryItemId) {
        throw new Error('Menu item and inventory item are required');
      }
      if (!Number.isFinite(consumeQty) || consumeQty <= 0) {
        throw new Error('consumeQty must be a positive number');
      }

      const selectedInventory = inventoryItemsById.get(newRule.inventoryItemId);
      if (selectedInventory?.unit === 'pcs' && !Number.isInteger(consumeQty)) {
        throw new Error('consumeQty must be a whole number for pcs items');
      }

      const res = await fetch(`${apiBaseUrl}/admin/inventory/rule`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          menuItemId: newRule.menuItemId,
          inventoryItemId: newRule.inventoryItemId,
          consumeQty,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to create usage rule');

      setFlash(t.saved);
      const selectedInv = inventoryItemsById.get(newRule.inventoryItemId);
      setNewRule((prev) => ({
        ...prev,
        consumeQty: selectedInv?.unit === 'pcs' ? '1' : prev.consumeQty,
      }));
      await loadInventorySummary({ silent: true });
    } catch (e) {
      console.error('Failed to create usage rule', e);
      setError(e instanceof Error ? e.message : 'Failed to create usage rule');
    } finally {
      setSubmittingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    const ok = window.confirm(language === 'en' ? 'Delete this usage rule?' : 'حذف قاعدة الاستهلاك؟');
    if (!ok) return;
    setDeletingRuleId(ruleId);
    setError('');
    setSuccessMessage('');
    try {
      const res = await fetch(`${apiBaseUrl}/admin/inventory/rule/${ruleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to delete usage rule');
      setFlash(t.saved);
      await loadInventorySummary({ silent: true });
    } catch (e) {
      console.error('Failed to delete rule', e);
      setError(e instanceof Error ? e.message : 'Failed to delete usage rule');
    } finally {
      setDeletingRuleId(null);
    }
  };

  const startEditItem = (item: InventoryItemRow) => {
    setEditingItemId(item.id);
    setEditingItemDraft({
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      lowStockThreshold: String(item.lowStockThreshold),
      active: item.active,
      notes: item.notes || '',
    });
  };

  const cancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemDraft(null);
  };

  const saveEditItem = async (item: InventoryItemRow) => {
    if (editingItemId !== item.id || !editingItemDraft) return;
    setSavingItemId(item.id);
    setError('');
    setSuccessMessage('');
    try {
      const threshold = Number(editingItemDraft.lowStockThreshold);
      if (!Number.isFinite(threshold) || threshold < 0) {
        throw new Error('lowStockThreshold must be a non-negative number');
      }
      if (item.unit === 'pcs' && !Number.isInteger(threshold)) {
        throw new Error('lowStockThreshold must be a whole number for pcs units');
      }

      const res = await fetch(`${apiBaseUrl}/admin/inventory/item/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          nameEn: editingItemDraft.nameEn.trim(),
          nameAr: editingItemDraft.nameAr.trim(),
          lowStockThreshold: threshold,
          active: editingItemDraft.active,
          notes: editingItemDraft.notes.trim() || null,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to update inventory item');
      }
      setFlash(t.saved);
      cancelEditItem();
      await loadInventorySummary({ silent: true });
    } catch (e) {
      console.error('Failed to update inventory item', e);
      setError(e instanceof Error ? e.message : 'Failed to update inventory item');
    } finally {
      setSavingItemId(null);
    }
  };

  const startEditRule = (rule: InventoryRule) => {
    setEditingRuleId(rule.id);
    setEditingRuleDraft({
      menuItemId: rule.menuItemId,
      inventoryItemId: rule.inventoryItemId,
      consumeQty: String(rule.consumeQty),
    });
  };

  const cancelEditRule = () => {
    setEditingRuleId(null);
    setEditingRuleDraft(null);
  };

  const saveEditRule = async (ruleId: number) => {
    if (editingRuleId !== ruleId || !editingRuleDraft) return;
    setSavingRuleId(ruleId);
    setError('');
    setSuccessMessage('');
    try {
      const consumeQty = Number(editingRuleDraft.consumeQty);
      if (!Number.isFinite(consumeQty) || consumeQty <= 0) {
        throw new Error('consumeQty must be a positive number');
      }
      const selectedInventory = inventoryItemsById.get(editingRuleDraft.inventoryItemId);
      if (selectedInventory?.unit === 'pcs' && !Number.isInteger(consumeQty)) {
        throw new Error('consumeQty must be a whole number for pcs items');
      }

      const res = await fetch(`${apiBaseUrl}/admin/inventory/rule/${ruleId}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          menuItemId: editingRuleDraft.menuItemId,
          inventoryItemId: editingRuleDraft.inventoryItemId,
          consumeQty,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to update usage rule');
      }
      setFlash(t.saved);
      cancelEditRule();
      await loadInventorySummary({ silent: true });
    } catch (e) {
      console.error('Failed to update usage rule', e);
      setError(e instanceof Error ? e.message : 'Failed to update usage rule');
    } finally {
      setSavingRuleId(null);
    }
  };

  const formatMovementReason = (reason: string) => {
    if (reason === 'restock') return t.restock;
    if (reason === 'adjustment') return t.reasonAdjustment;
    if (reason === 'waste') return t.reasonWaste;
    if (reason === 'correction') return t.reasonCorrection;
    if (reason === 'sale') return t.reasonSale;
    return reason;
  };

  const renderMovementHistory = (item: InventoryItemRow) => {
    const loadingMovements = Boolean(loadingMovementsByItemId[item.id]);
    const movements = movementsByItemId[item.id] || [];
    return (
      <div className="border border-[var(--matte-black)] bg-[#fafafa]">
        <div className="px-3 py-2 border-b border-[var(--matte-black)] flex items-center justify-between gap-2">
          <div className="text-sm text-[var(--matte-black)] inline-flex items-center gap-2">
            <History size={14} />
            {t.recentMovements}
          </div>
          <button
            type="button"
            onClick={() => loadItemMovements(item.id, { force: true })}
            disabled={loadingMovements}
            className="px-2 py-1 border border-[var(--matte-black)] text-xs hover:bg-[var(--cool-gray)] disabled:opacity-60"
          >
            {t.refreshHistory}
          </button>
        </div>
        <div className="p-3 space-y-2">
          {loadingMovements ? (
            <div className="text-xs text-[var(--matte-black)] opacity-70">{t.loadingHistory}</div>
          ) : movements.length === 0 ? (
            <div className="text-xs text-[var(--matte-black)] opacity-70">{t.noMovements}</div>
          ) : (
            movements.map((movement) => {
              const delta = movement.direction === 'out' ? -Number(movement.qty || 0) : Number(movement.qty || 0);
              return (
                <div
                  key={movement.id}
                  className="border border-[var(--matte-black)] bg-[var(--crisp-white)] px-3 py-2 text-xs text-[var(--matte-black)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className={delta < 0 ? 'text-red-700' : 'text-emerald-700'}>
                      {delta < 0 ? '-' : '+'}
                      {formatQty(Math.abs(delta), item.unit)} {item.unit}
                    </div>
                    <div className="opacity-70">
                      {formatDateTime(movement.createdAt, language === 'ar' ? 'ar-SA' : 'en-US')}
                    </div>
                  </div>
                  <div className="mt-1 opacity-80">
                    {formatMovementReason(movement.reason)}
                    {movement.createdByName ? ` • ${t.byUser}: ${movement.createdByName}` : ''}
                    {movement.orderId ? ` • ${t.orderRef}: ${movement.orderId}` : ''}
                  </div>
                  {movement.note && <div className="mt-1 opacity-70">{movement.note}</div>}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderInventoryGroup = (groupTitle: string, items: InventoryItemRow[]) => (
    <div className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]">
      <div className="px-4 py-3 border-b-2 border-[var(--matte-black)] flex items-center justify-between">
        <h3 className="text-lg text-[var(--matte-black)]">{groupTitle}</h3>
        <span className="text-xs text-[var(--matte-black)] opacity-70">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <div className="p-4 text-sm text-[var(--matte-black)] opacity-70">{t.noItems}</div>
      ) : (
        <div className="divide-y divide-[var(--matte-black)]">
          {items.map((item) => {
            const customQty = customRestockQtyById[item.id] ?? '';
            const isEditingItem = editingItemId === item.id && editingItemDraft != null;
            const isExpanded = expandedItemId === item.id;
            const adjustmentDraft = getAdjustmentDraft(item);
            return (
              <div key={item.id} className="p-4 space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr_1.4fr] gap-4">
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        {!isEditingItem ? (
                          <>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base text-[var(--matte-black)]">
                                {language === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                              </div>
                              <span
                                className={`text-[10px] px-2 py-0.5 border rounded-full ${
                                  item.active
                                    ? 'border-[var(--matte-black)] text-[var(--matte-black)]'
                                    : 'border-red-700 text-red-700'
                                }`}
                              >
                                {item.active ? t.active : t.inactive}
                              </span>
                              {item.isLowStock && (
                                <span className="text-[10px] px-2 py-0.5 border border-amber-700 text-amber-800 rounded-full">
                                  {t.lowStock}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1 break-all">
                              {t.id}: <code>{item.id}</code>
                            </div>
                            {item.notes && (
                              <div className="text-xs text-[var(--matte-black)] opacity-80 mt-2">{item.notes}</div>
                            )}
                          </>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              value={editingItemDraft.nameEn}
                              onChange={(e) =>
                                setEditingItemDraft((prev) =>
                                  prev ? { ...prev, nameEn: e.target.value } : prev
                                )
                              }
                              className="px-2 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                              placeholder={t.nameEn}
                            />
                            <input
                              value={editingItemDraft.nameAr}
                              onChange={(e) =>
                                setEditingItemDraft((prev) =>
                                  prev ? { ...prev, nameAr: e.target.value } : prev
                                )
                              }
                              className="px-2 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                              placeholder={t.nameAr}
                            />
                            <input
                              type="number"
                              min={0}
                              step={item.unit === 'pcs' ? 1 : 0.01}
                              value={editingItemDraft.lowStockThreshold}
                              onChange={(e) =>
                                setEditingItemDraft((prev) =>
                                  prev ? { ...prev, lowStockThreshold: e.target.value } : prev
                                )
                              }
                              className="px-2 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                              placeholder={`${t.threshold} (${item.unit})`}
                            />
                            <label className="px-2 py-2 border-2 border-[var(--matte-black)] text-sm flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={editingItemDraft.active}
                                onChange={(e) =>
                                  setEditingItemDraft((prev) =>
                                    prev ? { ...prev, active: e.target.checked } : prev
                                  )
                                }
                              />
                              <span>
                                {t.status}: {editingItemDraft.active ? t.active : t.inactive}
                              </span>
                            </label>
                            <input
                              value={editingItemDraft.notes}
                              onChange={(e) =>
                                setEditingItemDraft((prev) =>
                                  prev ? { ...prev, notes: e.target.value } : prev
                                )
                              }
                              className="px-2 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)] sm:col-span-2"
                              placeholder={t.notes}
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 shrink-0">
                        {!isEditingItem ? (
                          <>
                            <button
                              type="button"
                              onClick={() => toggleManageItem(item.id)}
                              className="px-2 py-1 border border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] inline-flex items-center gap-1 text-xs"
                            >
                              <Settings2 size={12} />
                              {isExpanded ? t.close : t.manage}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEditItem(item)}
                              className="px-2 py-1 border border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] inline-flex items-center gap-1 text-xs"
                            >
                              <Edit2 size={12} />
                              {t.edit}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEditItem(item)}
                              disabled={savingItemId === item.id}
                              className="px-2 py-1 border border-emerald-700 text-emerald-700 hover:bg-emerald-700 hover:text-white disabled:opacity-60 inline-flex items-center gap-1 text-xs"
                            >
                              <Check size={12} />
                              {savingItemId === item.id ? t.saving : t.save}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditItem}
                              disabled={savingItemId === item.id}
                              className="px-2 py-1 border border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] disabled:opacity-60 inline-flex items-center gap-1 text-xs"
                            >
                              <X size={12} />
                              {t.cancel}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-sm text-[var(--matte-black)] space-y-1">
                    <div>
                      {t.stock}: <strong>{formatQty(item.stockQty, item.unit)}</strong> {item.unit}
                    </div>
                    <div>
                      {t.status}: {item.isLowStock ? t.lowStock : t.inStock}
                    </div>
                    <div>
                      {t.threshold}: {formatQty(item.lowStockThreshold, item.unit)} {item.unit}
                    </div>
                    <div className="text-xs opacity-70">{t.thresholdHint}</div>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wider text-[var(--matte-black)] opacity-70 mb-2">
                      {t.restock}
                    </div>

                    {item.type === 'bean' ? (
                      <div className="flex flex-wrap gap-2">
                        {beanRestockOptions.map((qty) => (
                          <button
                            key={`${item.id}-${qty}`}
                            type="button"
                            onClick={() => handleRestock(item, qty)}
                            disabled={restockingId === item.id}
                            className="px-3 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] disabled:opacity-60"
                          >
                            +{qty}g
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={customQty}
                          onChange={(e) =>
                            setCustomRestockQtyById((prev) => ({ ...prev, [item.id]: e.target.value }))
                          }
                          placeholder={item.unit === 'pcs' ? '1' : '0'}
                          className="w-28 px-2 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                        />
                        <button
                          type="button"
                          onClick={() => handleRestock(item, Number(customQty))}
                          disabled={restockingId === item.id || !customQty}
                          className="px-3 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] disabled:opacity-60"
                        >
                          {t.applyRestock}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && !isEditingItem && (
                  <div className="border border-[var(--matte-black)] bg-[#f6f2ea] p-4 space-y-4">
                    <div className="text-sm text-[var(--matte-black)] inline-flex items-center gap-2">
                      <Settings2 size={14} />
                      {t.stockActions}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
                      <div className="space-y-3">
                        <div className="border border-[var(--matte-black)] bg-[var(--crisp-white)] p-3">
                          <div className="text-sm text-[var(--matte-black)] mb-2">{t.adjustmentTitle}</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <label className="text-xs text-[var(--matte-black)]">
                              <div className="mb-1">{t.adjustmentQty}</div>
                              <input
                                type="number"
                                step={item.unit === 'pcs' ? 1 : 0.01}
                                value={adjustmentDraft.qtyDelta}
                                onChange={(e) =>
                                  setAdjustmentDraftById((prev) => ({
                                    ...prev,
                                    [item.id]: {
                                      ...getAdjustmentDraft(item),
                                      qtyDelta: e.target.value,
                                    },
                                  }))
                                }
                                placeholder={item.unit === 'pcs' ? '-1 or 1' : '-50 or 50'}
                                className="w-full px-2 py-2 border border-[var(--matte-black)] bg-[var(--crisp-white)]"
                              />
                            </label>
                            <label className="text-xs text-[var(--matte-black)]">
                              <div className="mb-1">{t.adjustmentReason}</div>
                              <select
                                value={adjustmentDraft.reason}
                                onChange={(e) =>
                                  setAdjustmentDraftById((prev) => ({
                                    ...prev,
                                    [item.id]: {
                                      ...getAdjustmentDraft(item),
                                      reason:
                                        e.target.value === 'waste'
                                          ? 'waste'
                                          : e.target.value === 'correction'
                                            ? 'correction'
                                            : 'adjustment',
                                    },
                                  }))
                                }
                                className="w-full px-2 py-2 border border-[var(--matte-black)] bg-[var(--crisp-white)]"
                              >
                                <option value="adjustment">{t.reasonAdjustment}</option>
                                <option value="waste">{t.reasonWaste}</option>
                                <option value="correction">{t.reasonCorrection}</option>
                              </select>
                            </label>
                            <label className="text-xs text-[var(--matte-black)] md:col-span-2">
                              <div className="mb-1">{t.adjustmentNote}</div>
                              <input
                                value={adjustmentDraft.note}
                                onChange={(e) =>
                                  setAdjustmentDraftById((prev) => ({
                                    ...prev,
                                    [item.id]: {
                                      ...getAdjustmentDraft(item),
                                      note: e.target.value,
                                    },
                                  }))
                                }
                                className="w-full px-2 py-2 border border-[var(--matte-black)] bg-[var(--crisp-white)]"
                              />
                            </label>
                          </div>
                          <div className="text-xs text-[var(--matte-black)] opacity-70 mt-2">
                            {t.adjustmentHelp}
                          </div>
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => handleAdjustInventory(item)}
                              disabled={adjustingItemId === item.id}
                              className="px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--matte-black)] text-[var(--crisp-white)] text-sm hover:opacity-90 disabled:opacity-60"
                            >
                              {adjustingItemId === item.id ? t.applyingAdjustment : t.applyAdjustment}
                            </button>
                          </div>
                        </div>
                      </div>

                      {renderMovementHistory(item)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl text-[var(--matte-black)]">{t.title}</h2>
          <p className="text-sm text-[var(--matte-black)] opacity-70 mt-1">{t.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => loadInventorySummary({ silent: true })}
          disabled={loading || refreshing}
          className="px-3 py-2 border-2 border-[var(--matte-black)] rounded-md text-sm flex items-center gap-2 hover:bg-[var(--cool-gray)] disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {t.refresh}
        </button>
      </div>

      {error && (
        <div className="border-2 border-red-700 text-red-800 bg-red-50 px-4 py-3 text-sm">
          {t.errorPrefix}: {error}
        </div>
      )}
      {successMessage && (
        <div className="border-2 border-emerald-700 text-emerald-800 bg-emerald-50 px-4 py-3 text-sm">
          {successMessage}
        </div>
      )}

      <div className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]">
        <div className="px-4 py-3 border-b-2 border-[var(--matte-black)] flex items-center justify-between gap-2">
          <div className="text-base text-[var(--matte-black)] inline-flex items-center gap-2">
            <Search size={16} />
            {t.quickFilters}
          </div>
          <div className="text-xs text-[var(--matte-black)] opacity-70">
            {t.showing} {filteredInventoryItems.length} {t.of} {inventoryItems.length}
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm text-[var(--matte-black)]">
            <div className="mb-1">{t.searchItems}</div>
            <input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
            />
          </label>
          <label className="text-sm text-[var(--matte-black)]">
            <div className="mb-1">{t.filterBy}</div>
            <select
              value={itemFilter}
              onChange={(e) =>
                setItemFilter(
                  e.target.value === 'low'
                    ? 'low'
                    : e.target.value === 'active'
                      ? 'active'
                      : e.target.value === 'inactive'
                        ? 'inactive'
                        : 'all'
                )
              }
              className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
            >
              <option value="all">{t.showAll}</option>
              <option value="low">{t.lowOnly}</option>
              <option value="active">{t.activeOnly}</option>
              <option value="inactive">{t.inactiveOnly}</option>
            </select>
          </label>
          <label className="text-sm text-[var(--matte-black)]">
            <div className="mb-1">{t.sortBy}</div>
            <select
              value={itemSort}
              onChange={(e) =>
                setItemSort(
                  e.target.value === 'updated'
                    ? 'updated'
                    : e.target.value === 'stock-asc'
                      ? 'stock-asc'
                      : e.target.value === 'stock-desc'
                        ? 'stock-desc'
                        : e.target.value === 'threshold-desc'
                          ? 'threshold-desc'
                          : 'name'
                )
              }
              className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
            >
              <option value="name">{t.nameAZ}</option>
              <option value="updated">{t.updatedNewest}</option>
              <option value="stock-asc">{t.stockLowHigh}</option>
              <option value="stock-desc">{t.stockHighLow}</option>
              <option value="threshold-desc">{t.thresholdHighLow}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]">
        <div className="px-4 py-3 border-b-2 border-[var(--matte-black)] flex items-center justify-between gap-2">
          <div className="text-base text-[var(--matte-black)]">{t.unlinkedWarningTitle}</div>
          <div
            className={`text-xs px-2 py-1 border rounded-full ${
              unlinkedMenuItems.length > 0
                ? 'border-amber-700 text-amber-800'
                : 'border-emerald-700 text-emerald-800'
            }`}
          >
            {unlinkedMenuItems.length}
          </div>
        </div>
        <div className="p-4">
          <p className="text-sm text-[var(--matte-black)] opacity-80 mb-3">{t.unlinkedWarningDesc}</p>
          {unlinkedMenuItems.length === 0 ? (
            <div className="text-sm text-[var(--matte-black)]">{t.noUnlinked}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {unlinkedMenuItems.slice(0, 18).map((item) => (
                <div
                  key={item.id}
                  className="border border-[var(--matte-black)] px-3 py-2 text-sm bg-[#fafafa]"
                >
                  <div className="text-[var(--matte-black)]">
                    {language === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                  </div>
                  <div className="text-xs text-[var(--matte-black)] opacity-70 mt-1">
                    {t.category}: {item.category || '-'} •{' '}
                    {item.available ? t.available : t.unavailable}
                  </div>
                  <button
                    type="button"
                    onClick={() => handlePrefillRule(item.id)}
                    className="mt-3 px-2 py-1 border border-[var(--matte-black)] text-xs hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)]"
                  >
                    {t.prefillRule}
                  </button>
                </div>
              ))}
              {unlinkedMenuItems.length > 18 && (
                <div className="px-3 py-2 text-sm border border-dashed border-[var(--matte-black)] text-[var(--matte-black)] opacity-70">
                  +{unlinkedMenuItems.length - 18}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1.35fr] gap-6">
        <div className="space-y-6">
          <form
            onSubmit={handleCreateInventoryItem}
            className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
          >
            <div className="px-4 py-3 border-b-2 border-[var(--matte-black)] flex items-center justify-between">
              <h3 className="text-lg text-[var(--matte-black)]">{t.addInventoryItem}</h3>
              <Plus size={16} className="text-[var(--matte-black)]" />
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm text-[var(--matte-black)]">
                <div className="mb-1">{t.nameEn}</div>
                <input
                  value={newInventoryItem.nameEn}
                  onChange={(e) =>
                    setNewInventoryItem((prev) => ({ ...prev, nameEn: e.target.value }))
                  }
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                  required
                />
              </label>
              <label className="text-sm text-[var(--matte-black)]">
                <div className="mb-1">{t.nameAr}</div>
                <input
                  value={newInventoryItem.nameAr}
                  onChange={(e) =>
                    setNewInventoryItem((prev) => ({ ...prev, nameAr: e.target.value }))
                  }
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                  required
                />
              </label>
              <label className="text-sm text-[var(--matte-black)]">
                <div className="mb-1">{t.type}</div>
                <select
                  value={newInventoryItem.type}
                  onChange={(e) =>
                    setNewInventoryItem((prev) => ({
                      ...prev,
                      type: e.target.value === 'sweet' ? 'sweet' : 'bean',
                    }))
                  }
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                >
                  <option value="bean">{t.bean}</option>
                  <option value="sweet">{t.sweet}</option>
                </select>
              </label>
              <label className="text-sm text-[var(--matte-black)]">
                <div className="mb-1">
                  {t.threshold} ({newInventoryItem.type === 'bean' ? 'g' : 'pcs'})
                </div>
                <input
                  type="number"
                  min={0}
                  step={newInventoryItem.type === 'sweet' ? 1 : 0.01}
                  value={newInventoryItem.lowStockThreshold}
                  onChange={(e) =>
                    setNewInventoryItem((prev) => ({
                      ...prev,
                      lowStockThreshold: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                />
              </label>
              <label className="text-sm text-[var(--matte-black)] md:col-span-2">
                <div className="mb-1">{t.notes}</div>
                <input
                  value={newInventoryItem.notes}
                  onChange={(e) =>
                    setNewInventoryItem((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                />
              </label>
            </div>
            <div className="px-4 pb-4">
              <button
                type="submit"
                disabled={submittingCreate}
                className="px-4 py-2 border-2 border-[var(--matte-black)] bg-[var(--matte-black)] text-[var(--crisp-white)] hover:opacity-90 disabled:opacity-60"
              >
                {submittingCreate ? t.creating : t.create}
              </button>
            </div>
          </form>

          <form
            ref={ruleFormRef}
            onSubmit={handleCreateRule}
            className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
          >
            <div className="px-4 py-3 border-b-2 border-[var(--matte-black)]">
              <h3 className="text-lg text-[var(--matte-black)]">{t.rulesTitle}</h3>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm text-[var(--matte-black)]">
                <div className="mb-1">{t.menuItem}</div>
                <select
                  value={newRule.menuItemId}
                  onChange={(e) => setNewRule((prev) => ({ ...prev, menuItemId: e.target.value }))}
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                >
                  {menuItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.category ? `[${item.category}] ` : ''}
                      {language === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-[var(--matte-black)]">
                <div className="mb-1">{t.inventoryItem}</div>
                <select
                  value={newRule.inventoryItemId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const selected = inventoryItemsById.get(nextId);
                    setNewRule((prev) => ({
                      ...prev,
                      inventoryItemId: nextId,
                      consumeQty:
                        selected?.unit === 'pcs'
                          ? '1'
                          : prev.consumeQty && Number(prev.consumeQty) > 0
                            ? prev.consumeQty
                            : '20',
                    }));
                  }}
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                >
                  {availableInventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      [{item.type}] {language === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-[var(--matte-black)] md:col-span-2">
                <div className="mb-1">
                  {t.consumeQty}{' '}
                  {newRule.inventoryItemId
                    ? `(${inventoryItemsById.get(newRule.inventoryItemId)?.unit || ''})`
                    : ''}
                </div>
                <input
                  type="number"
                  min={0.01}
                  step={inventoryItemsById.get(newRule.inventoryItemId)?.unit === 'pcs' ? 1 : 0.01}
                  value={newRule.consumeQty}
                  onChange={(e) => setNewRule((prev) => ({ ...prev, consumeQty: e.target.value }))}
                  className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
                />
              </label>
            </div>
            <div className="px-4 pb-4">
              <button
                type="submit"
                disabled={submittingRule || menuItems.length === 0 || availableInventoryItems.length === 0}
                className="px-4 py-2 border-2 border-[var(--matte-black)] bg-[var(--matte-black)] text-[var(--crisp-white)] hover:opacity-90 disabled:opacity-60"
              >
                {submittingRule ? t.addingRule : t.addRule}
              </button>
            </div>
          </form>
        </div>

        <div className="space-y-6">
          {renderInventoryGroup(t.beans, filteredBeanItems)}
          {renderInventoryGroup(t.sweets, filteredSweetItems)}
        </div>
      </div>

      <div className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]">
        <div className="px-4 py-3 border-b-2 border-[var(--matte-black)] flex items-center justify-between">
          <h3 className="text-lg text-[var(--matte-black)]">{t.linkedRules}</h3>
          <span className="text-xs text-[var(--matte-black)] opacity-70">
            {filteredUsageRules.length} / {usageRules.length}
          </span>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-b border-[var(--matte-black)]">
          <label className="text-sm text-[var(--matte-black)]">
            <div className="mb-1">{t.rulesSearch}</div>
            <input
              value={ruleSearch}
              onChange={(e) => setRuleSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
            />
          </label>
          <label className="text-sm text-[var(--matte-black)]">
            <div className="mb-1">{t.category}</div>
            <select
              value={ruleCategoryFilter}
              onChange={(e) => setRuleCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
            >
              <option value="all">{t.allCategories}</option>
              {ruleCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[var(--matte-black)]">
            <div className="mb-1">{t.sortBy}</div>
            <select
              value={ruleSort}
              onChange={(e) =>
                setRuleSort(
                  e.target.value === 'inventory'
                    ? 'inventory'
                    : e.target.value === 'updated'
                      ? 'updated'
                      : 'menu'
                )
              }
              className="w-full px-3 py-2 border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]"
            >
              <option value="menu">{t.menuAZ}</option>
              <option value="inventory">{t.inventoryAZ}</option>
              <option value="updated">{t.recentlyChanged}</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-[var(--matte-black)] opacity-70">{t.loading}</div>
        ) : filteredUsageRules.length === 0 ? (
          <div className="p-4 text-sm text-[var(--matte-black)] opacity-70">{t.noRules}</div>
        ) : (
          <>
            <div className="md:hidden divide-y divide-[var(--matte-black)]">
              {filteredUsageRules.map((rule) => {
                const isEditing = editingRuleId === rule.id && editingRuleDraft != null;
                const selectedEditInventory = isEditing
                  ? inventoryItemsById.get(editingRuleDraft.inventoryItemId)
                  : null;
                return (
                  <div key={`mobile-${rule.id}`} className="p-4 space-y-3">
                    {!isEditing ? (
                      <>
                        <div className="text-sm text-[var(--matte-black)]">
                          <span className="opacity-70">{t.menuItem}: </span>
                          {language === 'ar'
                            ? rule.menuItem.nameAr || rule.menuItem.nameEn
                            : rule.menuItem.nameEn || rule.menuItem.nameAr}
                        </div>
                        <div className="text-sm text-[var(--matte-black)]">
                          <span className="opacity-70">{t.inventoryItem}: </span>
                          {language === 'ar'
                            ? rule.inventoryItem.nameAr || rule.inventoryItem.nameEn
                            : rule.inventoryItem.nameEn || rule.inventoryItem.nameAr}
                        </div>
                        <div className="text-sm text-[var(--matte-black)]">
                          <span className="opacity-70">{t.consumeQty}: </span>
                          {formatQty(Number(rule.consumeQty || 0), rule.inventoryItem.unit || '')}{' '}
                          {rule.inventoryItem.unit || ''}
                        </div>
                        <div className="text-xs text-[var(--matte-black)] opacity-70">
                          {t.category}: {rule.menuItem.category || '-'}
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        <select
                          value={editingRuleDraft.menuItemId}
                          onChange={(e) =>
                            setEditingRuleDraft((prev) =>
                              prev ? { ...prev, menuItemId: e.target.value } : prev
                            )
                          }
                          className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                        >
                          {menuItems.map((item) => (
                            <option key={`m-${rule.id}-${item.id}`} value={item.id}>
                              {item.category ? `[${item.category}] ` : ''}
                              {language === 'ar'
                                ? item.nameAr || item.nameEn
                                : item.nameEn || item.nameAr}
                            </option>
                          ))}
                        </select>
                        <select
                          value={editingRuleDraft.inventoryItemId}
                          onChange={(e) =>
                            setEditingRuleDraft((prev) =>
                              prev ? { ...prev, inventoryItemId: e.target.value } : prev
                            )
                          }
                          className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                        >
                          {availableInventoryItems.map((item) => (
                            <option key={`i-${rule.id}-${item.id}`} value={item.id}>
                              [{item.type}] {language === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0.01}
                          step={selectedEditInventory?.unit === 'pcs' ? 1 : 0.01}
                          value={editingRuleDraft.consumeQty}
                          onChange={(e) =>
                            setEditingRuleDraft((prev) =>
                              prev ? { ...prev, consumeQty: e.target.value } : prev
                            )
                          }
                          className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm bg-[var(--crisp-white)]"
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEditRule(rule)}
                          className="px-2 py-1 border border-[var(--matte-black)] text-xs inline-flex items-center gap-1 hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)]"
                        >
                          <Edit2 size={12} />
                          {t.edit}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEditRule(rule.id)}
                            disabled={savingRuleId === rule.id}
                            className="px-2 py-1 border border-emerald-700 text-emerald-700 text-xs inline-flex items-center gap-1 hover:bg-emerald-700 hover:text-white disabled:opacity-60"
                          >
                            <Check size={12} />
                            {savingRuleId === rule.id ? t.saving : t.save}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditRule}
                            disabled={savingRuleId === rule.id}
                            className="px-2 py-1 border border-[var(--matte-black)] text-xs inline-flex items-center gap-1 hover:bg-[var(--cool-gray)] disabled:opacity-60"
                          >
                            <X size={12} />
                            {t.cancel}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={deletingRuleId === rule.id || savingRuleId === rule.id}
                        className="px-2 py-1 border border-red-700 text-red-700 text-xs inline-flex items-center gap-1 hover:bg-red-700 hover:text-white disabled:opacity-60"
                      >
                        <Trash2 size={12} />
                        {deletingRuleId === rule.id ? t.deleting : t.delete}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-[780px] w-full">
                <thead>
                  <tr className="border-b-2 border-[var(--matte-black)]">
                    <th className="px-3 py-2 text-left text-sm text-[var(--matte-black)]">{t.menuItem}</th>
                    <th className="px-3 py-2 text-left text-sm text-[var(--matte-black)]">{t.inventoryItem}</th>
                    <th className="px-3 py-2 text-left text-sm text-[var(--matte-black)]">{t.consumeQty}</th>
                    <th className="px-3 py-2 text-left text-sm text-[var(--matte-black)]">{t.category}</th>
                    <th className="px-3 py-2 text-left text-sm text-[var(--matte-black)]" />
                  </tr>
                </thead>
                <tbody>
                  {filteredUsageRules.map((rule) => {
                    const isEditing = editingRuleId === rule.id && editingRuleDraft != null;
                    const selectedEditInventory = isEditing
                      ? inventoryItemsById.get(editingRuleDraft.inventoryItemId)
                      : null;
                    return (
                      <tr key={rule.id} className="border-b border-[var(--matte-black)] last:border-b-0 align-top">
                        <td className="px-3 py-2 text-sm text-[var(--matte-black)]">
                          {!isEditing ? (
                            language === 'ar'
                              ? rule.menuItem.nameAr || rule.menuItem.nameEn
                              : rule.menuItem.nameEn || rule.menuItem.nameAr
                          ) : (
                            <select
                              value={editingRuleDraft.menuItemId}
                              onChange={(e) =>
                                setEditingRuleDraft((prev) =>
                                  prev ? { ...prev, menuItemId: e.target.value } : prev
                                )
                              }
                              className="w-full px-2 py-1 border border-[var(--matte-black)] bg-[var(--crisp-white)]"
                            >
                              {menuItems.map((item) => (
                                <option key={`desk-m-${rule.id}-${item.id}`} value={item.id}>
                                  {item.category ? `[${item.category}] ` : ''}
                                  {language === 'ar'
                                    ? item.nameAr || item.nameEn
                                    : item.nameEn || item.nameAr}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--matte-black)]">
                          {!isEditing ? (
                            language === 'ar'
                              ? rule.inventoryItem.nameAr || rule.inventoryItem.nameEn
                              : rule.inventoryItem.nameEn || rule.inventoryItem.nameAr
                          ) : (
                            <select
                              value={editingRuleDraft.inventoryItemId}
                              onChange={(e) =>
                                setEditingRuleDraft((prev) =>
                                  prev ? { ...prev, inventoryItemId: e.target.value } : prev
                                )
                              }
                              className="w-full px-2 py-1 border border-[var(--matte-black)] bg-[var(--crisp-white)]"
                            >
                              {availableInventoryItems.map((item) => (
                                <option key={`desk-i-${rule.id}-${item.id}`} value={item.id}>
                                  [{item.type}] {language === 'ar' ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--matte-black)]">
                          {!isEditing ? (
                            <>
                              {formatQty(Number(rule.consumeQty || 0), rule.inventoryItem.unit || '')}{' '}
                              {rule.inventoryItem.unit || ''}
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0.01}
                                step={selectedEditInventory?.unit === 'pcs' ? 1 : 0.01}
                                value={editingRuleDraft.consumeQty}
                                onChange={(e) =>
                                  setEditingRuleDraft((prev) =>
                                    prev ? { ...prev, consumeQty: e.target.value } : prev
                                  )
                                }
                                className="w-28 px-2 py-1 border border-[var(--matte-black)] bg-[var(--crisp-white)]"
                              />
                              <span className="text-xs opacity-70">{selectedEditInventory?.unit || ''}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--matte-black)]">
                          {rule.menuItem.category || '-'}
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--matte-black)]">
                          <div className="flex flex-wrap gap-2">
                            {!isEditing ? (
                              <button
                                type="button"
                                onClick={() => startEditRule(rule)}
                                className="px-2 py-1 border border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] inline-flex items-center gap-1"
                              >
                                <Edit2 size={14} />
                                {t.edit}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => saveEditRule(rule.id)}
                                  disabled={savingRuleId === rule.id}
                                  className="px-2 py-1 border border-emerald-700 text-emerald-700 hover:bg-emerald-700 hover:text-white disabled:opacity-60 inline-flex items-center gap-1"
                                >
                                  <Check size={14} />
                                  {savingRuleId === rule.id ? t.saving : t.save}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditRule}
                                  disabled={savingRuleId === rule.id}
                                  className="px-2 py-1 border border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--cool-gray)] disabled:opacity-60 inline-flex items-center gap-1"
                                >
                                  <X size={14} />
                                  {t.cancel}
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteRule(rule.id)}
                              disabled={deletingRuleId === rule.id || savingRuleId === rule.id}
                              className="px-2 py-1 border border-red-700 text-red-700 hover:bg-red-700 hover:text-white disabled:opacity-60 inline-flex items-center gap-1"
                            >
                              <Trash2 size={14} />
                              {deletingRuleId === rule.id ? t.deleting : t.delete}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {!loading && inventoryItems.length === 0 && (
        <div className="text-sm text-[var(--matte-black)] opacity-70">{t.createFirstHint}</div>
      )}
    </div>
  );
}
