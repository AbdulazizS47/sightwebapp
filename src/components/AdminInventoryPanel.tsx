import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Trash2, Edit2, Check, X } from 'lucide-react';
import { apiBaseUrl } from '../utils/supabase/info';

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

const formatQty = (value: number, unit: InventoryUnit | string) => {
  if (unit === 'pcs') return String(Math.round(value));
  return Number(value).toFixed(Number.isInteger(value) ? 0 : 2);
};

export function AdminInventoryPanel({ sessionToken, language }: AdminInventoryPanelProps) {
  const isRTL = language === 'ar';
  const text = {
    en: {
      title: 'Inventory',
      subtitle: 'Track beans and sweets stock and link menu items to consumption rules.',
      refresh: 'Refresh',
      loading: 'Loading inventory...',
      inventoryItems: 'Inventory Items',
      beans: 'Beans',
      sweets: 'Sweets',
      lowStock: 'Low Stock',
      active: 'Active',
      inactive: 'Inactive',
      stock: 'Stock',
      threshold: 'Low Stock Threshold',
      restock: 'Restock',
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
      loading: 'جاري تحميل المخزون...',
      inventoryItems: 'عناصر المخزون',
      beans: 'البن',
      sweets: 'الحلويات',
      lowStock: 'مخزون منخفض',
      active: 'نشط',
      inactive: 'غير نشط',
      stock: 'المخزون',
      threshold: 'حد المخزون المنخفض',
      restock: 'إضافة مخزون',
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

  const beanItems = useMemo(
    () => inventoryItems.filter((item) => item.type === 'bean'),
    [inventoryItems]
  );
  const sweetItems = useMemo(
    () => inventoryItems.filter((item) => item.type === 'sweet'),
    [inventoryItems]
  );

  const availableInventoryItems = useMemo(
    () => inventoryItems.filter((item) => item.active),
    [inventoryItems]
  );

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
            return (
              <div key={item.id} className="p-4 grid grid-cols-1 xl:grid-cols-[1.2fr_1fr_1.4fr] gap-4">
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
                        <button
                          type="button"
                          onClick={() => startEditItem(item)}
                          className="px-2 py-1 border border-[var(--matte-black)] text-[var(--matte-black)] hover:bg-[var(--matte-black)] hover:text-[var(--crisp-white)] inline-flex items-center gap-1 text-xs"
                        >
                          <Edit2 size={12} />
                          {t.edit}
                        </button>
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
                    {t.threshold}: {formatQty(item.lowStockThreshold, item.unit)} {item.unit}
                  </div>
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
          {renderInventoryGroup(t.beans, beanItems)}
          {renderInventoryGroup(t.sweets, sweetItems)}
        </div>
      </div>

      <div className="border-2 border-[var(--matte-black)] bg-[var(--crisp-white)]">
        <div className="px-4 py-3 border-b-2 border-[var(--matte-black)] flex items-center justify-between">
          <h3 className="text-lg text-[var(--matte-black)]">{t.linkedRules}</h3>
          <span className="text-xs text-[var(--matte-black)] opacity-70">{usageRules.length}</span>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-[var(--matte-black)] opacity-70">{t.loading}</div>
        ) : usageRules.length === 0 ? (
          <div className="p-4 text-sm text-[var(--matte-black)] opacity-70">{t.noRules}</div>
        ) : (
          <>
            <div className="md:hidden divide-y divide-[var(--matte-black)]">
              {usageRules.map((rule) => {
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
                  {usageRules.map((rule) => {
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
