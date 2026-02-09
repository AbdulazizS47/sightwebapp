import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Plus,
  ShoppingBag,
  ShoppingCart,
  ArrowLeft,
  Edit2,
  Save,
  Trash2,
  Coffee,
  Slash,
} from 'lucide-react';
import categoryFallback from 'figma:asset/6a698afc3834913c1c2ac422fa5bd04b815dc28c.png';
import coffeeIcon from '../assets/COFFEE.png';
import v60Icon from '../assets/V60.png';
import notCoffeeIcon from '../assets/NOT COFFEE.ong.png';
import sweetsIcon from '../assets/SWEET.png';
import { apiBaseUrl } from '../utils/supabase/info';

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

interface Category {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
  iconUrl?: string;
}

interface CartItem {
  id: string;
  nameEn: string;
  nameAr: string;
  price: number;
  quantity: number;
}

interface User {
  id: string;
  phoneNumber: string;
  name: string;
  // Align type with App.tsx: include optional role
  role?: 'admin' | 'user';
}

interface MenuPageProps {
  onBack: () => void;
  onOpenCart: () => void;
  cartItems: CartItem[];
  onUpdateCart: (...args: [CartItem[] | ((items: CartItem[]) => CartItem[])]) => void;
  language: 'en' | 'ar';
  user: User | null;
  sessionToken: string | null;
}

export function MenuPage({
  onBack,
  onOpenCart,
  cartItems,
  onUpdateCart,
  language,
  user,
  sessionToken,
}: MenuPageProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const cart = cartItems;
  const setCart = onUpdateCart;

  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    if (loading) return;
    const el = headerRef.current;
    if (!el) return;

    const update = () => setHeaderHeight(el.getBoundingClientRect().height);
    update();

    let ro: ResizeObserver | null = null;
    try {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } catch {
      // Fallback
      window.addEventListener('resize', update);
    }

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [loading]);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [showNewItem, setShowNewItem] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    price: 0,
    category: '',
    available: true,
  });
  const [newCategory, setNewCategory] = useState({
    nameEn: '',
    nameAr: '',
  });
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  // Check if user is admin (superuser)
  // const isAdmin = user?.phoneNumber === '0547444145';
  // Use role-based gating instead of hardcoded phone
  const isAdmin = user?.role === 'admin';

  const content = {
    en: {
      menu: 'Menu',
      cart: 'Cart',
      items: 'items',
      sar: 'SAR',
    },
    ar: {
      menu: 'القائمة',
      cart: 'السلة',
      items: 'عناصر',
      sar: 'ريال',
    },
  };

  const text = content[language];
  const isRTL = language === 'ar';

  useEffect(() => {
    // Load menu on mount (avoid resetting demo data automatically)
    loadMenu();

    // Listen for admin updates across tabs
    let bc: BroadcastChannel | null = null;
    try {
      if ('BroadcastChannel' in window) {
        bc = new BroadcastChannel('menu-updates');
        bc.onmessage = (ev) => {
          if (ev?.data?.type === 'menu-updated') {
            loadMenu();
          }
        };
      }
    } catch {}

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'menuVersion') {
        loadMenu();
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
    };
  }, []);

  const loadMenu = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/menu/items`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Read body ONCE as text, then attempt JSON parsing with sanitization fallback
      const raw = await response.text();
      console.log('Menu raw response:', raw);
      let data: any = null;
      try {
        data = JSON.parse(raw);
      } catch {
        const sanitized = raw
          .replace(/^\uFEFF/, '') // strip BOM if present
          .replace(/^\)\]\}',?\s*/, '') // strip common anti-CSRF prefix
          .trim();
        const objStart = sanitized.indexOf('{');
        const objEnd = sanitized.lastIndexOf('}');
        const arrStart = sanitized.indexOf('[');
        const arrEnd = sanitized.lastIndexOf(']');
        if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
          data = JSON.parse(sanitized.slice(objStart, objEnd + 1));
        } else if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
          data = JSON.parse(sanitized.slice(arrStart, arrEnd + 1));
        } else {
          throw new Error('Invalid response format for menu endpoint');
        }
      }

      if (data && data.success) {
        setCategories(data.categories.sort((a: Category, b: Category) => a.order - b.order));
        setMenuItems(
          data.items.map((it: any) => ({
            ...it,
            descriptionEn: it.description ?? '',
            descriptionAr: it.description ?? '',
            price: typeof it.price === 'number' ? it.price : parseFloat(it.price) || 0,
          }))
        );
        if (data.categories.length > 0) {
          setActiveCategory(data.categories[0].id);
        }
      } else {
        throw new Error('Menu payload missing expected fields');
      }
    } catch (error) {
      console.error('Error loading menu:', error);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (item: MenuItem) => {
    setCart((prevCart) => {
      const existingItem = prevCart.find((cartItem) => cartItem.id === item.id);
      if (existingItem) {
        return prevCart.map((cartItem) =>
          cartItem.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem
        );
      }
      return [...prevCart, { ...item, quantity: 1 }];
    });
    // Quick feedback for add-to-cart
    setLastAddedId(item.id);
    setTimeout(() => setLastAddedId(null), 1000);
  };

  // Image upload helper for admin (in-component scope)
  const uploadImageFile = async (file: File): Promise<string | undefined> => {
    if (!sessionToken || !isAdmin) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${apiBaseUrl}/admin/upload-image`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        body: formData,
      });
      const json = await res.json();
      if (json.success && json.imageUrl) return json.imageUrl;
      throw new Error(json.error || 'Upload failed');
    } catch (err) {
      console.error('Image upload failed:', err);
      alert('Image upload failed');
    }
  };

  const updateItem = async (
    id: string,
    patch?: Partial<MenuItem>,
    options?: { exitEdit?: boolean }
  ) => {
    if (!sessionToken || !isAdmin) return;

    setLoading(true);
    try {
      const itemToUpdate = menuItems.find((i) => i.id === id);
      const merged = { ...itemToUpdate, ...patch };

      const response = await fetch(`${apiBaseUrl}/admin/menu/item/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          ...merged,
          // Map description fields for backend compatibility
          description: merged?.descriptionEn || merged?.descriptionAr || '',
        }),
      });

      const data = await response.json();

      if (data.success) {
        if (options?.exitEdit !== false) setEditingItem(null);
        await loadMenu();
      } else {
        alert('Failed to update item: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error updating item:', error);
      alert('Error updating item: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const removeItemImage = async (id: string) => {
    if (!sessionToken || !isAdmin) return;
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

  const deleteItem = async (id: string) => {
    if (!sessionToken || !isAdmin) return;
    if (!confirm('Are you sure you want to delete this item?')) return;

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
        await loadMenu();
      } else {
        alert('Failed to delete item');
      }
    } catch (error) {
      console.error('Error deleting item:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleAvailability = async (id: string) => {
    if (!sessionToken || !isAdmin) return;

    const item = menuItems.find((i) => i.id === id);
    if (!item) return;

    const updatedItems = menuItems.map((i) =>
      i.id === id ? { ...i, available: !i.available } : i
    );
    setMenuItems(updatedItems);

    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/item/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          ...item,
          available: !item.available,
          price: Number(item.price ?? 0),
          description: item.descriptionEn || item.descriptionAr || '',
        }),
      });

      if (!response.ok) {
        // Revert on error
        setMenuItems(menuItems);
      }
    } catch (error) {
      console.error('Error toggling availability:', error);
      setMenuItems(menuItems);
    }
  };

  const addNewItem = async () => {
    if (!sessionToken || !isAdmin) return;

    if (!newItem.nameEn || !newItem.nameAr || !newItem.price) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/item`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          ...newItem,
          price: Number(newItem.price || 0),
          category: activeCategory,
          description: newItem.descriptionEn || newItem.descriptionAr || '',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowNewItem(false);
        setNewItem({
          nameEn: '',
          nameAr: '',
          descriptionEn: '',
          descriptionAr: '',
          price: 0,
          category: '',
          available: true,
        });
        await loadMenu();
      }
    } catch (error) {
      console.error('Error adding item:', error);
    } finally {
      setLoading(false);
    }
  };

  const addNewCategory = async () => {
    if (!sessionToken || !isAdmin) return;

    if (!newCategory.nameEn || !newCategory.nameAr) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/menu/category`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          ...newCategory,
          order: categories.length,
        }),
      });

      const data = await response.json();
      console.log('Add category response:', data);

      if (data.success) {
        setShowNewCategory(false);
        setNewCategory({
          nameEn: '',
          nameAr: '',
        });
        await loadMenu();
      } else {
        console.error('Failed to add category:', data);
        alert('Failed to add category: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error adding category:', error);
      alert('Error adding category: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const updateCategory = async (id: string) => {
    if (!sessionToken || !isAdmin) return;

    setLoading(true);
    try {
      const categoryToUpdate = categories.find((c) => c.id === id);

      const response = await fetch(`${apiBaseUrl}/admin/menu/category/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(categoryToUpdate),
      });

      const data = await response.json();

      if (data.success) {
        setEditingCategory(null);
        await loadMenu();
      } else {
        alert('Failed to update category: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error updating category:', error);
      alert('Error updating category: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!sessionToken || !isAdmin) return;
    if (
      !confirm(
        language === 'ar'
          ? 'هل أنت متأكد من حذف هذا القسم؟ سيتم حذف جميع العناصر داخل هذا القسم.'
          : 'Are you sure you want to delete this category? All items in this category will be deleted.'
      )
    )
      return;

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
        await loadMenu();
      } else {
        alert('Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
    } finally {
      setLoading(false);
    }
  };

  const getItemsForCategory = (categoryId: string) => {
    return menuItems.filter((item) => item.category === categoryId && (isAdmin || item.available));
  };

  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const noFrameCategoryIds = new Set(['not-coffee']);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--crisp-white)] flex items-center justify-center">
        <div className="text-[var(--matte-black)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      {/* Fixed below the global top bar (pt-9 in App.tsx) */}
      <div
        ref={headerRef}
        className="fixed top-9 left-0 right-0 bg-[var(--crisp-white)] z-40 border-b border-[var(--matte-black)]"
      >
        <div className="flex items-center justify-between px-3 py-1.5">
          <button
            onClick={onBack}
            aria-label="Back"
            className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
          >
            <ArrowLeft size={16} className={isRTL ? 'rotate-180' : ''} />
          </button>

          <h1 className="text-sm text-[var(--matte-black)]">{text.menu}</h1>

          {/* Keep space for layout symmetry */}
          <div className="w-4" />
        </div>

        {/* Category Icons */}
        <div className="relative">
          <div
            className={
              `flex items-center gap-2 px-3 py-2 border-b border-[var(--matte-black)] border-opacity-20 ` +
              (isRTL ? 'flex-row-reverse' : '')
            }
          >
            <div
              className={
                `flex gap-2 overflow-x-auto overflow-y-visible scrollbar-hide flex-1 ` +
                (isRTL ? 'pl-2' : 'pr-2')
              }
            >
              {categories.map((category) => {
                const isNoFrame =
                  noFrameCategoryIds.has(category.id) ||
                  category.nameEn?.toLowerCase().includes('not coffee');
                return (
                  <div
                    key={category.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveCategory(category.id);
                      const element = document.getElementById(`category-${category.id}`);
                      if (element) {
                        const top =
                          element.getBoundingClientRect().top +
                          window.scrollY -
                          (headerHeight || 0) -
                          12;
                        window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setActiveCategory(category.id);
                        const element = document.getElementById(`category-${category.id}`);
                        if (element) {
                          const top =
                            element.getBoundingClientRect().top +
                            window.scrollY -
                            (headerHeight || 0) -
                            12;
                          window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
                        }
                        e.preventDefault();
                      }
                    }}
                    className={`flex flex-col items-center gap-1 flex-shrink-0 transition-all ${
                      activeCategory === category.id ? 'opacity-100' : 'opacity-60'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all relative overflow-hidden ${
                        activeCategory === category.id ? 'scale-[1.02]' : ''
                      } ${isNoFrame ? 'border-0' : 'border-2'} ${
                        isNoFrame
                          ? 'border-transparent'
                          : activeCategory === category.id
                            ? 'border-[var(--espresso-brown)]'
                            : 'border-[var(--matte-black)] border-opacity-30'
                      }`}
                    >
                    {activeCategory === category.id && !isNoFrame && (
                      <span className="absolute -inset-1 rounded-full border border-[var(--espresso-brown)]/30 shadow-[0_0_0_6px_rgba(88,62,45,0.22)]" />
                    )}
                    {(() => {
                      const iconById: Record<string, string> = {
                        coffee: coffeeIcon,
                        espresso: coffeeIcon,
                        'test-cat-3gl702': coffeeIcon,
                        v60: v60Icon,
                        'not-coffee': notCoffeeIcon,
                        cold: notCoffeeIcon,
                        pastries: sweetsIcon,
                        sweets: sweetsIcon,
                      };
                      const icon = iconById[category.id] || category.iconUrl || '';
                      if (isNoFrame) {
                        return (
                          <div className="relative w-5 h-5 flex items-center justify-center">
                            <Coffee size={16} strokeWidth={1.8} className="text-[var(--matte-black)]" />
                            <Slash
                              size={18}
                              strokeWidth={1.8}
                              className="absolute text-[var(--matte-black)]"
                            />
                          </div>
                        );
                      }

                      if (!icon) {
                        return <ShoppingBag size={16} className="text-[var(--matte-black)]" />;
                      }

                      const resolved =
                        icon.startsWith('figma:asset') || icon.includes('example.com')
                          ? categoryFallback
                          : icon;

                      return (
                        <img
                          src={resolved}
                          alt={language === 'en' ? category.nameEn : category.nameAr}
                          className="w-5 h-5 object-contain"
                        />
                      );
                    })()}
                  </div>
                  <span className="text-[8px] text-[var(--matte-black)] text-center leading-tight max-w-[60px]">
                    {language === 'en' ? category.nameEn : category.nameAr}
                  </span>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCategory(category.id);
                        }}
                        className="p-1 bg-[var(--crisp-white)] border border-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)] transition-colors"
                      >
                        <Edit2 size={10} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCategory(category.id);
                        }}
                        className="p-1 bg-[var(--crisp-white)] border border-[var(--matte-black)] hover:bg-red-600 hover:text-[var(--crisp-white)] transition-colors"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                  </div>
                );
              })}

              {isAdmin && (
                <button
                  onClick={() => setShowNewCategory(true)}
                  className="flex flex-col items-center gap-2 flex-shrink-0"
                >
                  <div className="w-9 h-9 rounded-full border-2 border-dashed border-[var(--matte-black)] flex items-center justify-center hover:border-[var(--espresso-brown)] transition-colors">
                    <Plus size={14} />
                  </div>
                  <span className="text-xs">Add</span>
                </button>
              )}
            </div>

            <button
              onClick={() => onOpenCart()}
              aria-label="Open cart"
              className={`relative flex-shrink-0 w-10 h-10 rounded-full border transition-all ${
                cartItemCount > 0
                  ? 'border-[var(--espresso-brown)] bg-[var(--espresso-brown)] text-[var(--crisp-white)] shadow-[0_6px_14px_rgba(88,62,45,0.25)]'
                  : 'border-[var(--matte-black)]/40 bg-[var(--crisp-white)] text-[var(--matte-black)] shadow-[0_4px_10px_rgba(0,0,0,0.08)] hover:border-[var(--espresso-brown)]'
              }`}
            >
              <div className="w-full h-full flex items-center justify-center">
                <ShoppingCart
                  size={18}
                  className={
                    cartItemCount > 0 ? 'text-[var(--crisp-white)]' : 'text-[var(--matte-black)]'
                  }
                />
              </div>
              {cartItemCount > 0 && (
                <span
                  className={
                    `absolute -top-1 bg-[var(--crisp-white)] text-[var(--espresso-brown)] text-[10px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center border border-[var(--espresso-brown)] ` +
                    (isRTL ? '-left-1' : '-right-1')
                  }
                >
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>

          {/* Edit Category Modal */}
          {isAdmin && editingCategory && (
            <div className="absolute top-full left-0 right-0 bg-[var(--crisp-white)] border-b-2 border-[var(--espresso-brown)] p-4 shadow-lg z-30">
              <h3 className="text-sm mb-3">Edit Category</h3>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={categories.find((c) => c.id === editingCategory)?.nameEn}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((c) =>
                        c.id === editingCategory ? { ...c, nameEn: e.target.value } : c
                      )
                    )
                  }
                  className="flex-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  placeholder="English Name"
                />
                <input
                  type="text"
                  value={categories.find((c) => c.id === editingCategory)?.nameAr}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((c) =>
                        c.id === editingCategory ? { ...c, nameAr: e.target.value } : c
                      )
                    )
                  }
                  className="flex-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  placeholder="Arabic Name"
                  dir="rtl"
                />
                <input
                  type="number"
                  value={categories.find((c) => c.id === editingCategory)?.order ?? 0}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((c) =>
                        c.id === editingCategory
                          ? { ...c, order: parseInt(e.target.value || '0') }
                          : c
                      )
                    )
                  }
                  className="w-28 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  placeholder="Order"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => updateCategory(editingCategory)}
                  className="px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm hover:bg-[var(--matte-black)] transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingCategory(null)}
                  className="px-4 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Add New Category Form */}
          {isAdmin && showNewCategory && (
            <div className="absolute top-full left-0 right-0 bg-[var(--crisp-white)] border-b-2 border-[var(--espresso-brown)] p-4 shadow-lg z-30">
              <h3 className="text-sm mb-3">Add New Category</h3>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="English Name"
                  value={newCategory.nameEn}
                  onChange={(e) => setNewCategory({ ...newCategory, nameEn: e.target.value })}
                  className="flex-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                />
                <input
                  type="text"
                  placeholder="Arabic Name"
                  value={newCategory.nameAr}
                  onChange={(e) => setNewCategory({ ...newCategory, nameAr: e.target.value })}
                  className="flex-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                  dir="rtl"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addNewCategory}
                  className="px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm hover:bg-[var(--matte-black)] transition-colors"
                >
                  <Plus size={14} className="inline mr-1" />
                  Add
                </button>
                <button
                  onClick={() => {
                    setShowNewCategory(false);
                    setNewCategory({ nameEn: '', nameAr: '' });
                  }}
                  className="px-4 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Spacer so content doesn't sit under fixed header */}
      <div style={{ height: headerHeight }} />

      {/* Menu Items by Category */}
      <div className="p-3">
        {categories.map((category) => {
          const categoryItems = getItemsForCategory(category.id);
          // Always render category block; show empty state if no items

          return (
            <div key={category.id} id={`category-${category.id}`} className="mb-6 scroll-mt-20">
              <h2 className="text-base mb-2 pb-1.5 border-b border-[var(--matte-black)]">
                {language === 'en' ? category.nameEn : category.nameAr}
              </h2>

              <div className="space-y-2.5">
                {categoryItems.map((item) => (
                  <div
                    key={item.id}
                    className={`bg-[var(--cool-gray)] border transition-all ${
                      editingItem === item.id
                        ? 'border-[var(--espresso-brown)]'
                        : 'border-transparent hover:border-[var(--espresso-brown)] hover:shadow-sm'
                    } ${!item.available && isAdmin ? 'opacity-50' : ''}`}
                  >
                    {editingItem === item.id ? (
                      <div className="p-3 space-y-2.5">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="English Name"
                            value={item.nameEn}
                            onChange={(e) =>
                              setMenuItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, nameEn: e.target.value } : i
                                )
                              )
                            }
                            className="flex-1 px-2.5 py-1.5 border border-[var(--matte-black)] text-xs"
                          />
                          <input
                            type="text"
                            placeholder="Arabic Name"
                            value={item.nameAr}
                            onChange={(e) =>
                              setMenuItems((prev) =>
                                prev.map((i) =>
                                  i.id === item.id ? { ...i, nameAr: e.target.value } : i
                                )
                              )
                            }
                            className="flex-1 px-2.5 py-1.5 border border-[var(--matte-black)] text-xs"
                            dir="rtl"
                          />
                        </div>
                        <textarea
                          placeholder="English Description"
                          value={item.descriptionEn}
                          onChange={(e) =>
                            setMenuItems((prev) =>
                              prev.map((i) =>
                                i.id === item.id ? { ...i, descriptionEn: e.target.value } : i
                              )
                            )
                          }
                          className="w-full px-2.5 py-1.5 border border-[var(--matte-black)] text-xs"
                          rows={2}
                        />
                        <textarea
                          placeholder="Arabic Description"
                          value={item.descriptionAr}
                          onChange={(e) =>
                            setMenuItems((prev) =>
                              prev.map((i) =>
                                i.id === item.id ? { ...i, descriptionAr: e.target.value } : i
                              )
                            )
                          }
                          className="w-full px-2.5 py-1.5 border border-[var(--matte-black)] text-xs"
                          rows={2}
                          dir="rtl"
                        />
                        {/* Admin image upload for existing item */}
                        {item.imageUrl && (
                          <div className="flex items-center gap-2">
                            <img
                              src={item.imageUrl}
                              alt="Preview"
                              className="w-16 h-16 object-cover border"
                            />
                            <button
                              type="button"
                              onClick={() => removeItemImage(item.id)}
                              className="px-2.5 py-1.5 border border-red-600 text-red-600 text-xs hover:bg-red-600 hover:text-white transition-colors"
                            >
                              Remove image
                            </button>
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const url = await uploadImageFile(file);
                              if (url) {
                                setMenuItems((prev) =>
                                  prev.map((i) => (i.id === item.id ? { ...i, imageUrl: url } : i))
                                );
                                // Persist immediately so it shows in the menu right away
                                await updateItem(item.id, { imageUrl: url }, { exitEdit: false });
                              }
                            }
                          }}
                          className="w-full text-xs"
                        />
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Price"
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
                            className="w-24 px-2.5 py-1.5 border border-[var(--matte-black)] text-xs"
                          />
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={item.available}
                              onChange={(e) =>
                                setMenuItems((prev) =>
                                  prev.map((i) =>
                                    i.id === item.id ? { ...i, available: e.target.checked } : i
                                  )
                                )
                              }
                              className="w-3.5 h-3.5"
                            />
                            Available
                          </label>
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => updateItem(item.id, undefined, { exitEdit: true })}
                            className="px-3 py-1.5 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-xs hover:bg-[var(--matte-black)] transition-colors"
                          >
                            <Save size={12} className="inline mr-1" />
                            Save
                          </button>
                          <button
                            onClick={() => setEditingItem(null)}
                            className="px-3 py-1.5 border border-[var(--matte-black)] text-xs hover:bg-[var(--cool-gray)] transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-stretch">
                        <div className="flex-1 p-3 flex flex-col justify-between min-h-[110px]">
                          <div>
                            <h3 className="text-base mb-1">
                              {language === 'en' ? item.nameEn : item.nameAr}
                              {isAdmin && !item.available && (
                                <span className="ml-1.5 text-[10px] text-red-600">(Hidden)</span>
                              )}
                            </h3>
                            <p className="text-xs opacity-70 mb-2 line-clamp-2">
                              {language === 'en' ? item.descriptionEn : item.descriptionAr}
                            </p>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-sm">
                              {Number(item.price).toFixed(2)} {text.sar}
                            </div>
                            {isAdmin ? (
                              <div className="flex gap-1">
                                <button
                                  onClick={() => setEditingItem(item.id)}
                                  className="px-2.5 py-1 border border-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)] hover:border-[var(--espresso-brown)] transition-colors text-[10px]"
                                >
                                  <Edit2 size={10} className="inline mr-0.5" />
                                  Edit
                                </button>
                                <button
                                  onClick={() => toggleAvailability(item.id)}
                                  className="px-1.5 py-1 border border-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)] hover:border-[var(--espresso-brown)] transition-colors text-[10px]"
                                >
                                  {item.available ? '👁️' : '🚫'}
                                </button>
                                <button
                                  onClick={() => deleteItem(item.id)}
                                  className="px-1.5 py-1 border border-[var(--matte-black)] hover:bg-red-600 hover:text-[var(--crisp-white)] hover:border-red-600 transition-colors text-[10px]"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            ) : item.available ? (
                              <button
                                onClick={() => addToCart(item)}
                                className="px-5 py-1.5 border border-[var(--matte-black)] hover:bg-[var(--espresso-brown)] hover:text-[var(--crisp-white)] hover:border-[var(--espresso-brown)] transition-colors text-xs"
                              >
                                {lastAddedId === item.id
                                  ? language === 'en'
                                    ? 'Added ✓'
                                    : 'تمت الإضافة ✓'
                                  : language === 'en'
                                    ? 'ADD'
                                    : 'أضف'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {item.imageUrl && (
                          <div className="w-28 flex-shrink-0 bg-[var(--matte-black)] bg-opacity-10">
                            <img
                              src={item.imageUrl}
                              alt={language === 'en' ? item.nameEn : item.nameAr}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {isAdmin && activeCategory === category.id && (
                  <>
                    {!showNewItem ? (
                      <button
                        onClick={() => setShowNewItem(true)}
                        className="w-full py-4 border-2 border-dashed border-[var(--matte-black)] hover:bg-[var(--cool-gray)] transition-colors flex items-center justify-center gap-2"
                      >
                        <Plus size={18} />
                        Add Item to {language === 'en' ? category.nameEn : category.nameAr}
                      </button>
                    ) : (
                      <div className="bg-[var(--crisp-white)] p-4 border-2 border-[var(--espresso-brown)]">
                        <h3 className="text-sm mb-3">
                          Add New Item to {language === 'en' ? category.nameEn : category.nameAr}
                        </h3>
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="English Name"
                              value={newItem.nameEn}
                              onChange={(e) => setNewItem({ ...newItem, nameEn: e.target.value })}
                              className="flex-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                            />
                            <input
                              type="text"
                              placeholder="Arabic Name"
                              value={newItem.nameAr}
                              onChange={(e) => setNewItem({ ...newItem, nameAr: e.target.value })}
                              className="flex-1 px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                              dir="rtl"
                            />
                          </div>
                          <textarea
                            placeholder="English Description"
                            value={newItem.descriptionEn}
                            onChange={(e) =>
                              setNewItem({ ...newItem, descriptionEn: e.target.value })
                            }
                            className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                            rows={2}
                          />
                          <textarea
                            placeholder="Arabic Description"
                            value={newItem.descriptionAr}
                            onChange={(e) =>
                              setNewItem({ ...newItem, descriptionAr: e.target.value })
                            }
                            className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                            rows={2}
                            dir="rtl"
                          />
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Price (SAR)"
                            value={newItem.price}
                            onChange={(e) =>
                              setNewItem({ ...newItem, price: parseFloat(e.target.value) || 0 })
                            }
                            className="w-full px-3 py-2 border-2 border-[var(--matte-black)] text-sm"
                          />
                          {/* Admin image upload for new item */}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const url = await uploadImageFile(file);
                                if (url) {
                                  setNewItem({ ...newItem, imageUrl: url });
                                }
                              }
                            }}
                            className="w-full text-sm"
                          />
                          {newItem.imageUrl && (
                            <img
                              src={newItem.imageUrl as string}
                              alt="Preview"
                              className="w-full h-32 object-cover border"
                            />
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={addNewItem}
                              className="px-4 py-2 bg-[var(--espresso-brown)] text-[var(--crisp-white)] text-sm hover:bg-[var(--matte-black)] transition-colors"
                            >
                              <Plus size={14} className="inline mr-1" />
                              Add Item
                            </button>
                            <button
                              onClick={() => {
                                setShowNewItem(false);
                                setNewItem({
                                  nameEn: '',
                                  nameAr: '',
                                  descriptionEn: '',
                                  descriptionAr: '',
                                  price: 0,
                                  category: '',
                                  available: true,
                                });
                              }}
                              className="px-4 py-2 border-2 border-[var(--matte-black)] text-sm hover:bg-[var(--cool-gray)] transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
