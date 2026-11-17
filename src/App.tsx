import {
  BarChart3,
  Boxes,
  Flame,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { CustomersView } from './components/CustomersView';
import { DashboardView } from './components/DashboardView';
import { FinanceView } from './components/FinanceView';
import { InventoryView } from './components/InventoryView';
import { NotificationCenter } from './components/NotificationCenter';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PosView } from './components/PosView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SalesView } from './components/SalesView';
import { SettingsView } from './components/SettingsView';
import { SignInScreen } from './components/SignInScreen';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { useDepotData } from './hooks/useDepotData';
import { usePushNotifications } from './hooks/usePushNotifications';
import type { AppSection } from './types/gas';

const NAV_ITEMS: { id: AppSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
  { id: 'pos', label: 'Nova Venda / PDV', icon: ShoppingCart },
  { id: 'sales', label: 'Vendas e Entregas', icon: Truck },
  { id: 'inventory', label: 'Estoque de Botijões', icon: Boxes },
  { id: 'customers', label: 'Clientes', icon: Users },
  { id: 'finance', label: 'Financeiro e Caixa', icon: BarChart3 },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

function WorkspaceShell() {
  const {
    user,
    authReady,
    depotReady,
    activeDepotId,
    availableDepots,
    switchDepot,
    authError,
    logout,
  } = useAuth();
  const {
    depot,
    cylinders,
    customers,
    sales,
    movements,
    expenses,
    members,
    permissions,
    loading,
    hasPendingWrites,
    error,
  } = useDepotData();
  const push = usePushNotifications({
    uid: user?.uid,
    loading,
    cylinders,
    sales,
  });
  const [activeSection, setActiveSection] = useState<AppSection>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const saved = window.sessionStorage.getItem('lucygas_active_section') as AppSection | null;
    return saved && NAV_ITEMS.some((item) => item.id === saved) ? saved : 'dashboard';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [preselectedCustomerId, setPreselectedCustomerId] = useState<string | null>(null);

  if (user && !depotReady && authError) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 max-w-md w-full space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center shrink-0">
              <Flame className="w-4 h-4" />
            </div>
            <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
              Erro ao carregar distribuidora
            </h1>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 rounded-lg p-3 break-words">
            {authError}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={logout}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Sair
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-orange-600 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-orange-700 cursor-pointer"
            >
              Tentar Novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!authReady || (user && !depotReady)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm font-medium">
          <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center">
            <Flame className="w-4 h-4" />
          </div>
          <span>Carregando distribuidora...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignInScreen />;
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.id === 'dashboard') return permissions.viewDashboard;
    if (item.id === 'pos') return permissions.createSales;
    if (item.id === 'sales') return permissions.viewSales;
    if (item.id === 'inventory') return permissions.viewInventory;
    if (item.id === 'customers') return permissions.viewCustomers;
    if (item.id === 'finance') return permissions.viewFinance;
    return true;
  });

  const resolvedSection: AppSection = visibleNavItems.some((item) => item.id === activeSection)
    ? activeSection
    : (visibleNavItems[0]?.id ?? 'settings');

  const currentNav = visibleNavItems.find((item) => item.id === resolvedSection) ?? visibleNavItems[0] ?? NAV_ITEMS[6];
  const currency = depot?.currency ?? 'BRL';
  const depotId = activeDepotId ?? user.uid;

  const handleSelectNav = (id: AppSection) => {
    setActiveSection(id);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('lucygas_active_section', id);
    }
    setMobileMenuOpen(false);
  };

  const handleStartSaleForCustomer = (customerId: string) => {
    if (!permissions.createSales) return;
    setPreselectedCustomerId(customerId);
    setActiveSection('pos');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 sticky top-0 h-screen">
        <div className="h-16 px-6 flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center shrink-0">
            <Flame className="w-4 h-4" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            Lucygas
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Navegação principal">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = resolvedSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-900 dark:bg-slate-800 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-orange-400' : 'text-slate-400 dark:text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
              {user.displayName || 'Operador'}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Sair da conta"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center">
                  <Flame className="w-4 h-4" />
                </div>
                <span className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">Lucygas</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = resolvedSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-slate-900 dark:bg-slate-800 text-white'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-orange-400' : ''}`} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {user.displayName || 'Operador'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 flex items-center justify-between gap-3 sm:gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
                {depot?.name || 'Distribuidora'}
              </span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate whitespace-nowrap">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <NotificationCenter
              permission={push.permission}
              prefs={push.prefs}
              alerts={push.alerts}
              unreadCount={push.unreadCount}
              feedbackMsg={push.feedbackMsg}
              isPushActive={push.isPushActive}
              onEnablePush={push.requestAndEnable}
              onDisablePush={push.disablePush}
              onUpdatePrefs={push.updatePrefs}
              onSendTest={push.sendTestNotification}
              onMarkAsRead={push.markAsRead}
              onMarkAllAsRead={push.markAllAsRead}
              onNavigate={setActiveSection}
            />
            <PWAInstallButton />
            {permissions.createSales && resolvedSection !== 'pos' && (
              <button
                type="button"
                onClick={() => handleSelectNav('pos')}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova Venda</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1400px] w-full mx-auto">
          {error && (
            <div role="alert" className="mb-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl p-4 text-sm text-red-800 dark:text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-6" aria-busy="true">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 animate-pulse"
                  >
                    <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
                    <div className="h-7 w-32 bg-slate-200 dark:bg-slate-800 rounded mt-3" />
                  </div>
                ))}
              </div>
              <div className="h-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
              {resolvedSection === 'dashboard' && permissions.viewDashboard && (
                <DashboardView
                  uid={depotId}
                  currency={currency}
                  cylinders={cylinders}
                  sales={sales}
                  customers={customers}
                  permissions={permissions}
                  onNavigate={handleSelectNav}
                />
              )}
              {resolvedSection === 'pos' && permissions.createSales && (
                <PosView
                  uid={depotId}
                  depot={depot}
                  currency={currency}
                  cylinders={cylinders}
                  customers={customers}
                  preselectedCustomerId={preselectedCustomerId}
                  onClearPreselectedCustomer={() => setPreselectedCustomerId(null)}
                  onNavigate={handleSelectNav}
                />
              )}
              {resolvedSection === 'sales' && permissions.viewSales && (
                <SalesView
                  uid={depotId}
                  depotName={depot?.name}
                  currency={currency}
                  sales={sales}
                  cylinders={cylinders}
                  customers={customers}
                  expenses={expenses}
                  drivers={depot?.drivers ?? []}
                  permissions={permissions}
                />
              )}
              {resolvedSection === 'inventory' && permissions.viewInventory && (
                <InventoryView
                  uid={depotId}
                  currency={currency}
                  cylinders={cylinders}
                  movements={movements}
                  permissions={permissions}
                  onNavigate={handleSelectNav}
                />
              )}
              {resolvedSection === 'customers' && permissions.viewCustomers && (
                <CustomersView
                  uid={depotId}
                  currency={currency}
                  customers={customers}
                  permissions={permissions}
                  onStartSaleForCustomer={handleStartSaleForCustomer}
                />
              )}
              {resolvedSection === 'finance' && permissions.viewFinance && (
                <FinanceView
                  uid={depotId}
                  currency={currency}
                  sales={sales}
                  expenses={expenses}
                  permissions={permissions}
                />
              )}
              {resolvedSection === 'settings' && (
                <SettingsView
                  uid={depotId}
                  currentUserUid={user.uid}
                  currentUserEmail={user.email ?? ''}
                  availableDepots={availableDepots}
                  onSwitchDepot={switchDepot}
                  depot={depot}
                  cylinders={cylinders}
                  sales={sales}
                  movements={movements}
                  expenses={expenses}
                  members={members}
                  permissions={permissions}
                  pushControls={{
                    permission: push.permission,
                    prefs: push.prefs,
                    isPushActive: push.isPushActive,
                    feedbackMsg: push.feedbackMsg,
                    onEnablePush: push.requestAndEnable,
                    onDisablePush: push.disablePush,
                    onUpdatePrefs: push.updatePrefs,
                    onSendTest: push.sendTestNotification,
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
      <OfflineIndicator hasPendingWrites={hasPendingWrites} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceShell />
      </AuthProvider>
    </ThemeProvider>
  );
}
