import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dashboard } from './Dashboard';
import { ClipboardList, LayoutDashboard, Package, ShoppingCart, Users, CreditCard, TrendingUp, Tag, BarChart3, LogOut, UserCog, RotateCcw, Sparkles, SlidersHorizontal, Warehouse, ShieldCheck, Settings } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from '../../lib/auth-context';
import { BrandLogo } from './BrandLogo';
import { PortalProfileSettingsModal } from './PortalProfileSettingsModal';

const loadPointOfSale = () => import('./PointOfSale');
const loadProductManagement = () => import('./ProductManagement');
const loadSalesManagement = () => import('./SalesManagement');
const loadCustomerManagement = () => import('./CustomerManagement');
const loadPredictiveAnalytics = () => import('./PredictiveAnalytics');
const loadPromotionManagement = () => import('./PromotionManagement');
const loadReportsAnalytics = () => import('./ReportsAnalytics');
const loadUserManagement = () => import('./UserManagement');
const loadReturnManagement = () => import('./ReturnManagement');
const loadNotificationCenter = () => import('./NotificationCenter');
const loadInventoryLogPage = () => import('./InventoryLogPage');
const loadAuditLogViewer = () => import('./AuditLogViewer');

const PointOfSale = lazy(() => loadPointOfSale().then((module) => ({ default: module.PointOfSale })));
const ProductManagement = lazy(() => loadProductManagement().then((module) => ({ default: module.ProductManagement })));
const SalesManagement = lazy(() => loadSalesManagement().then((module) => ({ default: module.SalesManagement })));
const CustomerManagement = lazy(() => loadCustomerManagement().then((module) => ({ default: module.CustomerManagement })));
const PredictiveAnalytics = lazy(() => loadPredictiveAnalytics().then((module) => ({ default: module.PredictiveAnalytics })));
const PromotionManagement = lazy(() => loadPromotionManagement().then((module) => ({ default: module.PromotionManagement })));
const ReportsAnalytics = lazy(() => loadReportsAnalytics().then((module) => ({ default: module.ReportsAnalytics })));
const UserManagement = lazy(() => loadUserManagement().then((module) => ({ default: module.UserManagement })));
const ReturnManagement = lazy(() => loadReturnManagement().then((module) => ({ default: module.ReturnManagement })));
const NotificationCenter = lazy(() => loadNotificationCenter().then((module) => ({ default: module.NotificationCenter })));
const InventoryLogPage = lazy(() => loadInventoryLogPage().then((module) => ({ default: module.InventoryLogPage })));
const AuditLogViewer = lazy(() => loadAuditLogViewer().then((module) => ({ default: module.AuditLogViewer })));

function clearOrphanedModalState() {
  if (typeof document === 'undefined') return;

  const dialogSelector =
    '[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="sheet-content"], [role="dialog"], [role="alertdialog"]';

  const isVisible = (element: Element) => {
    const node = element as HTMLElement;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

  // An opening dialog starts at opacity 0 (zoom-in animation), so an "open"
  // state counts as visible too.
  const visibleDialog = Array.from(document.querySelectorAll(dialogSelector)).find(
    (node) => isVisible(node) || node.getAttribute('data-state') === 'open',
  );

  if (visibleDialog) return;

  // Only delete leftovers React no longer tracks. Removing a node React still
  // renders (e.g. the notification popup backdrop) makes React crash later with
  // "Failed to execute 'removeChild' on 'Node'".
  const isReactManaged = (node: Element) =>
    Object.keys(node).some((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$'));

  document
    .querySelectorAll(
      [
        '[data-slot="dialog-overlay"]',
        '[data-slot="alert-dialog-overlay"]',
        '[data-slot="sheet-overlay"]',
        '[data-slot="drawer-overlay"]',
        '[data-radix-dialog-overlay]',
        '.fixed.inset-0.z-40',
        '.fixed.inset-0.z-50',
      ].join(', '),
    )
    .forEach((node) => {
      if (!isReactManaged(node)) node.remove();
    });

  document
    .querySelectorAll(dialogSelector)
    .forEach((node) => {
      if (!isVisible(node) && !isReactManaged(node)) {
        node.remove();
      }
    });

  document
    .querySelectorAll('[data-aria-hidden="true"], [inert]')
    .forEach((node) => {
      node.removeAttribute('aria-hidden');
      node.removeAttribute('data-aria-hidden');
      node.removeAttribute('inert');
    });

  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.removeAttribute('data-scroll-locked');
  document.body.removeAttribute('aria-hidden');
  document.documentElement.style.pointerEvents = '';
  document.documentElement.style.overflow = '';
}

export function AdminLayout() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState('dashboard');
  const { user, logout } = useAuth();
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);

  useEffect(() => {
    clearOrphanedModalState();
    const cleanupTimers = [window.setTimeout(clearOrphanedModalState, 100), window.setTimeout(clearOrphanedModalState, 500)];

    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearOrphanedModalState();
      }
    };

    window.addEventListener('keydown', clearOnEscape);
    window.addEventListener('focus', clearOrphanedModalState);
    return () => {
      cleanupTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('keydown', clearOnEscape);
      window.removeEventListener('focus', clearOrphanedModalState);
    };
  }, []);

  useEffect(() => {
    clearOrphanedModalState();
  }, [activeView]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'pos', label: 'Point of Sale', icon: CreditCard },
    { id: 'product-list', label: 'Product List', icon: Package },
    { id: 'product-settings', label: 'Product Settings', icon: SlidersHorizontal },
    { id: 'inventory', label: 'Inventory', icon: Warehouse },
    { id: 'inventory-log', label: 'Inventory Log', icon: ClipboardList },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'returns', label: 'Replacement', icon: RotateCcw },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'promotions', label: 'Promotions', icon: Tag },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'users', label: 'Users', icon: UserCog },
    { id: 'audit-log', label: 'Security & Audit', icon: ShieldCheck },
    { id: 'profile-settings', label: 'Profile & Settings', icon: Settings },
  ];

  const preloadByView: Record<string, () => Promise<unknown>> = {
    pos: loadPointOfSale,
    'product-list': loadProductManagement,
    'product-settings': loadProductManagement,
    inventory: loadProductManagement,
    'inventory-log': loadInventoryLogPage,
    sales: loadSalesManagement,
    customers: loadCustomerManagement,
    analytics: loadPredictiveAnalytics,
    promotions: loadPromotionManagement,
    returns: loadReturnManagement,
    reports: loadReportsAnalytics,
    users: loadUserManagement,
    'audit-log': loadAuditLogViewer,
  };

  const renderContent = () => {
    switch (activeView) {
      case 'dashboard': return <Dashboard />;
      case 'pos': return <PointOfSale />;
      case 'product-list': return <ProductManagement view="list" onViewChange={(view) => setActiveView(view === 'list' ? 'product-list' : view === 'settings' ? 'product-settings' : 'inventory')} />;
      case 'product-settings': return <ProductManagement view="settings" onViewChange={(view) => setActiveView(view === 'list' ? 'product-list' : view === 'settings' ? 'product-settings' : 'inventory')} />;
      case 'inventory': return <ProductManagement view="inventory" onViewChange={(view) => setActiveView(view === 'list' ? 'product-list' : view === 'settings' ? 'product-settings' : 'inventory')} />;
      case 'inventory-log': return <InventoryLogPage />;
      case 'sales': return <SalesManagement />;
      case 'customers': return <CustomerManagement />;
      case 'analytics': return <PredictiveAnalytics />;
      case 'promotions': return <PromotionManagement />;
      case 'returns': return <ReturnManagement />;
      case 'reports': return <ReportsAnalytics />;
      case 'users': return <UserManagement />;
      case 'audit-log': return <AuditLogViewer />;
      default: return <Dashboard />;
    }
  };

  const activeLabel = navItems.find(item => item.id === activeView)?.label;

  return (
    <div className="flex h-screen bg-[#0E0E12] text-white p-3 gap-3">
      {/* Sidebar */}
      <aside className="w-64 bg-[#16161C] flex flex-col rounded-2xl border border-white/5 overflow-hidden">
        <div className="px-5 pt-5 pb-4 flex items-center gap-3">
          <BrandLogo size="md" />
          <div>
            <h1 className="text-white text-base leading-none">Meryl Shoes</h1>
          </div>
        </div>

        <div className="px-3">
          <div className="text-[10px] uppercase tracking-wider text-white/30 px-3 py-2">Menu</div>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-hide">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === 'profile-settings' ? isProfileSettingsOpen : activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'profile-settings') {
                    setIsProfileSettingsOpen(true);
                  } else {
                    setActiveView(item.id);
                  }
                }}
                onMouseEnter={() => void preloadByView[item.id]?.()}
                onFocus={() => void preloadByView[item.id]?.()}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm relative ${
                  isActive
                    ? 'bg-gradient-to-r from-[#E5202A] to-[#B81820] text-white shadow-lg shadow-red-900/30'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" />
                <span>{item.label}</span>
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#FFD60A]" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3">
          <div className="rounded-2xl p-4 bg-gradient-to-br from-[#FFD60A] to-[#FFB800] text-[#1A1A22] relative overflow-hidden">
            <Sparkles className="absolute -top-2 -right-2 w-16 h-16 opacity-20" />
            <button
              type="button"
              onClick={() => setIsProfileSettingsOpen(true)}
              title="Click to customize profile and settings"
              className="w-full flex items-center gap-2.5 mb-2 relative z-10 text-left hover:opacity-85 transition cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden border border-[#1A1A22]/30 bg-black/10 flex items-center justify-center shrink-0">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xs font-bold text-[#1A1A22]">{(user?.name || 'A').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] opacity-70 leading-none mb-0.5">Welcome back</div>
                <div className="text-xs leading-tight truncate font-bold">{user?.name || 'Administrator'}</div>
              </div>
            </button>
            <div className="mt-3 flex flex-col gap-1.5 relative z-10">
              <Button
                type="button"
                onClick={handleLogout}
                className="w-full bg-[#1A1A22] hover:bg-black text-white rounded-lg h-8 text-xs font-semibold transition"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#16161C] rounded-2xl border border-white/5">
        <header className="px-8 py-5 flex items-center justify-between border-b border-white/5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-white/40">Overview</div>
            <h2 className="text-white mt-0.5">{activeLabel}</h2>
          </div>
          <div className="flex items-center gap-3">
            <Suspense fallback={<div className="w-9 h-9 rounded-md bg-[#1D1D25] border border-white/5" />}>
              <NotificationCenter />
            </Suspense>
            <button
              type="button"
              onClick={() => setIsProfileSettingsOpen(true)}
              title="Click to customize profile and settings"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-[#1D1D25] py-1 pl-1 pr-3 hover:border-yellow-400/40 transition group cursor-pointer"
            >
              <div className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-[#E5202A] to-[#FFD60A] flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
                ) : (
                  (user?.name || 'A').charAt(0).toUpperCase()
                )}
              </div>
              <span className="text-xs font-medium text-white/80 group-hover:text-yellow-300 transition max-w-[100px] truncate">
                {user?.name?.split(' ')[0] || user?.username || 'Admin'}
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 sm:p-8 bg-[#0E0E12]">
          <Suspense fallback={<div className="text-sm text-white/60">Loading module...</div>}>
            {renderContent()}
          </Suspense>
        </main>
      </div>

      <PortalProfileSettingsModal
        isOpen={isProfileSettingsOpen}
        onClose={() => setIsProfileSettingsOpen(false)}
      />
    </div>
  );
}
