import { useState, useEffect } from 'react';
import { Globe, User as UserIcon, LogOut } from 'lucide-react';
import { LandingPage } from './components/LandingPage';
import { MenuPage } from './components/MenuPage';
import { CartModal } from './components/CartModal';
import { AuthModal } from './components/AuthModal';
import { ContactPage } from './components/ContactPage';
import { OrderSuccessModal } from './components/OrderSuccessModal';
import { OrderTrackingPage } from './components/OrderTrackingPage';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLoginPage } from './components/AdminLoginPage';
import { apiBaseUrl, enableHealthcheck } from './utils/supabase/info';
import { ProfilePage } from './components/ProfilePage';

type Page = 'landing' | 'menu' | 'contact' | 'dashboard' | 'admin-login' | 'profile' | 'order';
type Language = 'en' | 'ar';

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
  // Add optional role for admin gating in dashboard
  role?: 'admin' | 'user';
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem('language') : null;
      return v === 'ar' || v === 'en' ? v : 'en';
    } catch {
      return 'en';
    }
  });
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [completedOrderData, setCompletedOrderData] = useState<any>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [returnToCartAfterAuth, setReturnToCartAfterAuth] = useState(false);
  const [adminMenuMode, setAdminMenuMode] = useState<'edit' | 'order'>('order');

  // Set viewport meta tag for proper mobile rendering
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
      );
    } else {
      const newMeta = document.createElement('meta');
      newMeta.name = 'viewport';
      newMeta.content =
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(newMeta);
    }
  }, []);

  // Persist language across refreshes
  useEffect(() => {
    try {
      localStorage.setItem('language', language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    // Check for existing session
    const storedSession = localStorage.getItem('sessionToken');
    if (storedSession) {
      verifySession(storedSession);
    }

    // Check server health on startup
    checkServerHealth();
  }, []);

  const checkServerHealth = async () => {
    if (!enableHealthcheck) return;
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) {
        const data = await response.json();
        console.log('Server health check:', data);
      } else {
        console.error('Server health check failed:', response.status);
      }
    } catch (error) {
      console.error('Server not reachable:', error);
    }
  };

  const verifySession = async (token: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/auth/verify-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionToken: token }),
      });

      if (!response.ok) {
        console.error('Session verification failed:', response.status, response.statusText);
        localStorage.removeItem('sessionToken');
        return;
      }

      const data = await response.json();

      if (data.success) {
        setUser(data.user);
        setSessionToken(token);

        // Don't auto-navigate to admin - let admin edit menu directly
        // if (data.user.phoneNumber === '0547444145') {
        //   setCurrentPage('admin');
        // }
      } else {
        console.error('Session verification returned error:', data.error);
        localStorage.removeItem('sessionToken');
      }
    } catch (error) {
      console.error('Error verifying session:', error);
      // Don't remove token on network errors - might be temporary
      // Only clear if it's a clear auth failure
      if (error instanceof TypeError && (error as any).message?.includes('Load failed')) {
        console.warn('Network error during session verification - session token preserved');
      } else {
        localStorage.removeItem('sessionToken');
      }
    }
  };

  const handleAuthSuccess = (userData: User & { role?: 'admin' | 'user' }, token: string) => {
    setUser(userData as any);
    setSessionToken(token);
    localStorage.setItem('sessionToken', token);
    setShowAuth(false);

    // If sign-in was triggered from the cart, return the user back to the cart to complete ordering
    if (returnToCartAfterAuth && cartItems.length > 0) {
      setShowCart(true);
      setReturnToCartAfterAuth(false);
    }

    if (pendingHash) {
      const isDashboardTarget = pendingHash.startsWith('#/dashboard');
      if (isDashboardTarget && userData?.role !== 'admin') {
        alert(language === 'en' ? 'Admin access only' : 'الدخول للمدير فقط');
        setCurrentPage('landing');
        setPendingHash(null);
        return;
      }
      window.location.hash = pendingHash;
      if (isDashboardTarget) setCurrentPage('dashboard');
      setPendingHash(null);
    }
    // Auto-route to dashboard when signing in from Admin Login page
    if (userData?.role === 'admin' && currentPage === 'admin-login') {
      setCurrentPage('dashboard');
      window.location.hash = '/dashboard';
    }

    // Don't auto-navigate to admin - let admin edit menu directly
    // if (userData.phoneNumber === '0547444145') {
    //   setCurrentPage('admin');
    // }
  };

  const handleLogout = () => {
    setUser(null);
    setSessionToken(null);
    localStorage.removeItem('sessionToken');
    setCartItems([]);
    setShowCart(false);
    setAdminMenuMode('order');
    setCurrentPage('landing');
  };

  const toggleLanguage = () => {
    setLanguage((prev) => (prev === 'en' ? 'ar' : 'en'));
  };

  // Sync URL hash with currentPage for direct navigation (e.g., #/dashboard and #/dashboard/<tab>)
  useEffect(() => {
    const applyHash = () => {
      const raw = window.location.hash.replace('#/', '').trim();
      const [page, param] = raw.split('/');
      if (page === 'dashboard') {
        if (sessionToken && (user as any)?.role === 'admin') {
          setCurrentPage('dashboard');
        } else {
          setPendingHash(window.location.hash || '#/dashboard');
          setShowAuth(false);
          setCurrentPage('admin-login');
        }
        return;
      }
      if (page === 'order') {
        const decoded = param ? decodeURIComponent(param) : '';
        if (!decoded) {
          setCurrentPage('menu');
          window.location.hash = '/menu';
          return;
        }
        if (!sessionToken) {
          setPendingHash(window.location.hash || `#/order/${encodeURIComponent(decoded)}`);
          setShowAuth(true);
          setCurrentPage('landing');
          return;
        }
        setActiveOrderId(decoded);
        setCurrentPage('order');
        return;
      }
      if (
        page === 'landing' ||
        page === 'menu' ||
        page === 'contact' ||
        page === 'admin-login' ||
        page === 'profile'
      ) {
        setCurrentPage(page as Page);
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [sessionToken, user]);

  const navigateToOrder = (orderId: string) => {
    setActiveOrderId(orderId);
    setCurrentPage('order');
    window.location.hash = `/order/${encodeURIComponent(orderId)}`;
  };

  const handleNavigate = (page: 'menu' | 'contact' | 'dashboard' | 'admin-login' | 'profile') => {
    if (page === 'dashboard' && (!sessionToken || (user as any)?.role !== 'admin')) {
      setPendingHash('#/dashboard');
      setShowAuth(false);
      setCurrentPage('admin-login');
      window.location.hash = '/admin-login';
      return;
    }
    if (page === 'menu') {
      setAdminMenuMode('order');
    }
    setCurrentPage(page);
    window.location.hash = `/${page}`;
  };

  const handleAdminMenu = (mode: 'edit' | 'order') => {
    setAdminMenuMode(mode);
    setShowCart(false);
    setCurrentPage('menu');
    window.location.hash = '/menu';
  };

  const handleBack = () => {
    setCurrentPage('landing');
  };

  const handleOpenCart = () => {
    setShowCart(true);
  };

  const handleAuthRequired = () => {
    setShowCart(false);
    setShowAuth(true);
    setReturnToCartAfterAuth(true);
  };

  const handleOrderComplete = (orderId: string, orderData: any) => {
    setCompletedOrderId(orderId);
    setCompletedOrderData(orderData);
    setCartItems([]);
    try {
      localStorage.setItem('lastOrderId', orderId);
    } catch {
      // ignore
    }
  };

  const isRTL = language === 'ar';

  return (
    <div className="min-h-screen bg-[var(--crisp-white)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Top Bar */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-[var(--crisp-white)] border-b border-[var(--matte-black)]">
        <div className="flex items-center justify-between px-3 py-1.5">
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-1 text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors text-[11px]"
          >
            <Globe size={14} />
            <span>{language === 'en' ? 'العربية' : 'English'}</span>
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleNavigate('profile')}
                className="flex items-center gap-1 text-[11px] text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
              >
                <UserIcon size={14} />
                <span className="max-w-[100px] truncate">{user.name}</span>
              </button>
              {user.role === 'admin' && (
                <button
                  onClick={() => handleNavigate('dashboard')}
                  className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors text-[11px]"
                >
                  Dashboard
                </button>
              )}
              <button
                onClick={handleLogout}
                className="text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-1 text-[var(--matte-black)] hover:text-[var(--espresso-brown)] transition-colors text-[11px]"
            >
              <UserIcon size={14} />
              <span>{language === 'en' ? 'Sign In' : 'تسجيل الدخول'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="pt-9">
        {currentPage === 'landing' && (
          <LandingPage
            onNavigate={handleNavigate}
            onAdminNavigate={handleAdminMenu}
            isAdmin={user?.role === 'admin'}
            language={language}
          />
        )}

        {currentPage === 'menu' && (
          <MenuPage
            onBack={handleBack}
            onOpenCart={handleOpenCart}
            cartItems={cartItems}
            onUpdateCart={setCartItems}
            language={language}
            user={user}
            sessionToken={sessionToken}
            adminMode={adminMenuMode}
          />
        )}

        {currentPage === 'profile' && user && (
          <ProfilePage
            onBack={handleBack}
            language={language}
            user={user}
            sessionToken={sessionToken}
            onUpdateUser={(next) => setUser(next)}
            onNavigate={handleNavigate}
          />
        )}

        {currentPage === 'order' && sessionToken && activeOrderId && (
          <OrderTrackingPage
            onBack={() => handleNavigate('menu')}
            language={language}
            sessionToken={sessionToken}
            orderId={activeOrderId}
          />
        )}

        {currentPage === 'contact' && <ContactPage onBack={handleBack} language={language} />}

        {currentPage === 'dashboard' && sessionToken && (
          <AdminDashboard onBack={handleBack} sessionToken={sessionToken} language={language} />
        )}

        {currentPage === 'admin-login' && (
          <AdminLoginPage onBack={handleBack} onSuccess={handleAuthSuccess} language={language} />
        )}
      </div>

      {/* Admin access hidden — dashboard only via phone login */}
      {currentPage === 'landing' && <div />}

      {/* Modals */}
      {showCart && (
        <CartModal
          items={cartItems}
          onClose={() => setShowCart(false)}
          onUpdateCart={setCartItems}
          onOrderComplete={handleOrderComplete}
          onAuthRequired={handleAuthRequired}
          sessionToken={sessionToken}
          language={language}
        />
      )}

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={handleAuthSuccess}
          language={language}
        />
      )}

      {completedOrderId && completedOrderData && (
        <OrderSuccessModal
          orderId={completedOrderId}
          orderData={completedOrderData}
          onTrack={() => {
            const id = completedOrderId;
            setCompletedOrderId(null);
            setCompletedOrderData(null);
            navigateToOrder(id);
          }}
          onClose={() => {
            setCompletedOrderId(null);
            setCompletedOrderData(null);
          }}
          language={language}
        />
      )}
    </div>
  );
}
