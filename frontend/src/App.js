import { useState, useEffect, useCallback } from 'react';
import './index.css';

import { AuthProvider, useAuth }  from './contexts/AuthContext';
import { accounts as accountsApi, categories as categoriesApi, notifications as notiApi, profile as profileApi, getAccessToken } from './services/api';

import LoginPage        from './pages/LoginPage';
import RegisterPage     from './pages/RegisterPage';
import SetupAccountPage from './pages/SetupAccountPage';

import Sidebar from './components/layout/Sidebar';
import Topbar  from './components/layout/Topbar';
import QuickEntryPanel from './components/common/QuickEntryPanel';

import AnalyticsView    from './views/AnalyticsView';
import AssistantView    from './views/AssistantView';
import AccountsView     from './views/AccountsView';
import TransactionsView from './views/TransactionsView';
import BudgetsView      from './views/BudgetsView';
import GoalsView        from './views/GoalsView';
import RecurringView    from './views/RecurringView';
import CategoriesView   from './views/CategoriesView';
import ProfileView      from './views/ProfileView';

import { NAV } from './constants/data';

// ─── Loading Spinner ──────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F6FAFC]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-[#DCE8EE] border-t-[#2C6488] animate-spin" />
        <p className="text-sm text-slate-500">กำลังโหลด...</p>
      </div>
    </div>
  );
}

// ─── Main App Shell (requires auth) ──────────────────────────────────────────
function AppShell() {
  const { isAuthenticated, loading: authLoading, clearError } = useAuth();
  const [authPage, setAuthPage]     = useState('login'); // 'login' | 'register'
  const [authNotice, setAuthNotice] = useState('');
  const [appState, setAppState]     = useState('checking'); // 'checking'|'setup'|'app'
  const [view, setView]             = useState('analytics');
  const [initialAccountId, setInitialAccountId] = useState(null);
  const [collapsed, setCollapsed]   = useState(false);
  const [accounts,      setAccounts]      = useState([]);
  const [categories,    setCategories]    = useState([]);
  const [notiList,      setNotiList]      = useState([]);
  const [avatarUrl,     setAvatarUrl]     = useState(null);
  const [quickEntryRefreshKey, setQuickEntryRefreshKey] = useState(0);

  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Bootstrap: check if user has accounts already
  const bootstrap = useCallback(async () => {
    setAppState('checking');
    try {
      const [accs, cats, prof] = await Promise.all([
        accountsApi.list(),
        categoriesApi.list(),
        profileApi.get().catch(() => null),
      ]);
      // token ถูก clear (401 + refresh fail) → redirect กำลังเกิด ไม่ต้อง set state
      if (!getAccessToken()) return;
      setAccounts(accs || []);
      setCategories(cats || []);
      setAvatarUrl(prof?.avatar_url || null);
      setAppState(accs && accs.length > 0 ? 'app' : 'setup');
      // โหลด notifications (generate จาก recurring ที่ครบกำหนดด้วย)
      notiApi.list().then((n) => setNotiList(n || [])).catch(() => {});
    } catch {
      if (!getAccessToken()) return; // unauthorized → redirect happening
      setAppState('setup');
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setView('analytics'); // always start at dashboard on login
      bootstrap();
    }
  }, [isAuthenticated, bootstrap]);

  // Refresh accounts (called by views after CRUD)
  const refreshAccounts = useCallback(async () => {
    try {
      const accs = await accountsApi.list();
      setAccounts(accs || []);
    } catch {}
  }, []);

  // Refresh notifications (generate + fetch)
  const refreshNotifications = useCallback(async () => {
    try {
      const list = await notiApi.list();
      setNotiList(list || []);
    } catch {}
  }, []);

  // Refresh categories (called by CategoriesView)
  const refreshCategories = useCallback(async () => {
    try {
      const cats = await categoriesApi.list();
      setCategories(cats || []);
    } catch {}
  }, []);

  if (authLoading) return <Spinner />;

  // ── Not authenticated: show login / register ──
  if (!isAuthenticated) {
    if (authPage === 'login') {
      return <LoginPage
        notice={authNotice}
        onNoticeClear={() => setAuthNotice('')}
        onSwitch={() => { clearError(); setAuthNotice(''); setAuthPage('register'); }}
      />;
    }
    return <RegisterPage
      onSwitch={() => { clearError(); setAuthPage('login'); }}
      onRegisterSuccess={() => {
        clearError();
        setAuthNotice('สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ');
        setAuthPage('login');
      }}
    />;
  }

  // ── Authenticated: loading ──
  if (appState === 'checking') return <Spinner />;

  // ── Authenticated but no accounts: onboarding ──
  if (appState === 'setup') {
    return (
      <SetupAccountPage
        onComplete={() => setAppState('app')}
      />
    );
  }

  // ── Full app ──
  const pageTitle = view === 'profile'
    ? 'โปรไฟล์'
    : NAV.find((n) => n.id === view)?.label || '';

  return (
    <div className="flex h-screen overflow-hidden bg-[#F6FAFC]">
      <Sidebar
        view={view}
        setView={setView}
        accounts={accounts}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        avatarUrl={avatarUrl}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          pageTitle={pageTitle}
          onProfile={() => setView('profile')}
          notifications={notiList}
          onNotificationRefresh={refreshNotifications}
          onRefreshAccounts={refreshAccounts}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        />
        <main className="flex-1 overflow-y-auto">
          {view === 'analytics'    && (
            <AnalyticsView
              accounts={accounts}
              categories={categories}
              onGoProfile={() => setView('profile')}
              onGoAccounts={() => setView('accounts')}
              isDarkMode={isDarkMode}
            />
          )}
          {view === 'assistant'    && (
            <AssistantView
              accounts={accounts}
              categories={categories}
              onRefresh={async () => {
                await Promise.all([refreshAccounts(), refreshNotifications()]);
                setQuickEntryRefreshKey((v) => v + 1);
              }}
            />
          )}
          {view === 'accounts'     && (
            <AccountsView
              accounts={accounts}
              onRefresh={refreshAccounts}
              onGoTransactions={(accId) => {
                setInitialAccountId(accId);
                setView('transactions');
              }}
            />
          )}
          {view === 'transactions' && (
            <TransactionsView
              accounts={accounts}
              categories={categories}
              onRefreshAccounts={refreshAccounts}
              onNotificationRefresh={refreshNotifications}
              onGoAccounts={() => setView('accounts')}
              initialAccountId={initialAccountId}
              onClearInitialAccountId={() => setInitialAccountId(null)}
              quickEntryRefreshKey={quickEntryRefreshKey}
            />
          )}
          {view === 'budgets'      && (
            <BudgetsView categories={categories} />
          )}
          {view === 'goals'        && (
            <GoalsView accounts={accounts} onRefreshAccounts={refreshAccounts} quickEntryRefreshKey={quickEntryRefreshKey} />
          )}
          {view === 'recurring'    && (
            <RecurringView
              accounts={accounts}
              categories={categories}
              onNotificationRefresh={refreshNotifications}
            />
          )}
          {view === 'categories'   && (
            <CategoriesView onRefresh={refreshCategories} />
          )}
          {view === 'profile'      && (
            <ProfileView />
          )}
        </main>
        {view !== 'assistant' && (
          <QuickEntryPanel
            accounts={accounts}
            categories={categories}
            onSaved={async () => {
              await Promise.all([refreshAccounts(), refreshNotifications()]);
              setQuickEntryRefreshKey((v) => v + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Root: wrap with AuthProvider ────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
