import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import './index.css';

import { AuthProvider, useAuth }  from './contexts/AuthContext';
import { SnackbarProvider }        from './contexts/SnackbarContext';
import { accounts as accountsApi, categories as categoriesApi, notifications as notiApi, profile as profileApi, getAccessToken } from './services/api';

import LoginPage        from './pages/LoginPage';
import RegisterPage     from './pages/RegisterPage';
import SetupAccountPage from './pages/SetupAccountPage';

import Navbar from './components/layout/Navbar';

import AnalyticsView    from './views/AnalyticsView';
import AssistantView    from './views/AssistantView';
import AccountsView     from './views/AccountsView';
import TransactionsView from './views/TransactionsView';
import BudgetsView      from './views/BudgetsView';
import GoalsView        from './views/GoalsView';
import RecurringView    from './views/RecurringView';
import CategoriesView   from './views/CategoriesView';
import ProfileView      from './views/ProfileView';

// ─── view id ↔ URL path ───────────────────────────────────────────────────────
const VIEW_TO_PATH = {
  analytics:    '/dashboard',
  assistant:    '/assistant',
  accounts:     '/accounts',
  transactions: '/transactions',
  budgets:      '/budgets',
  goals:        '/goals',
  recurring:    '/recurring',
  categories:   '/categories',
  profile:      '/profile',
};
const PATH_TO_VIEW = Object.fromEntries(Object.entries(VIEW_TO_PATH).map(([v, p]) => [p, v]));

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

// ─── Page container (max width) ───────────────────────────────────────────────
function Container({ children }) {
  return <div className="mx-auto w-full max-w-7xl">{children}</div>;
}

// ─── Main App Shell (requires auth) ──────────────────────────────────────────
function AppShell() {
  const { isAuthenticated, loading: authLoading, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [authNotice, setAuthNotice] = useState('');
  const [appState, setAppState]     = useState('checking'); // 'checking' | 'ready'
  const [onboarded, setOnboarded]   = useState(false);
  const [initialAccountId, setInitialAccountId] = useState(null);

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

  // Bootstrap: load accounts/categories/profile (incl. onboarded flag)
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
      setOnboarded(!!prof?.onboarded);
      setAppState('ready');
      notiApi.list().then((n) => setNotiList(n || [])).catch(() => {});
    } catch {
      if (!getAccessToken()) return; // unauthorized → redirect happening
      setAccounts([]);
      setOnboarded(false);
      setAppState('ready');
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) bootstrap();
  }, [isAuthenticated, bootstrap]);

  const refreshAccounts = useCallback(async () => {
    try {
      const accs = await accountsApi.list();
      setAccounts(accs || []);
    } catch {}
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const list = await notiApi.list();
      setNotiList(list || []);
    } catch {}
  }, []);

  const refreshCategories = useCallback(async () => {
    try {
      const cats = await categoriesApi.list();
      setCategories(cats || []);
    } catch {}
  }, []);

  const goView = useCallback((id) => navigate(VIEW_TO_PATH[id] || '/dashboard'), [navigate]);

  if (authLoading) return <Spinner />;

  // ── Not authenticated: login / register routes ──
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/register" element={
          <RegisterPage
            onSwitch={() => { clearError(); navigate('/login'); }}
            onRegisterSuccess={() => {
              clearError();
              setAuthNotice('สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ');
              navigate('/login');
            }}
          />
        } />
        <Route path="/login" element={
          <LoginPage
            notice={authNotice}
            onNoticeClear={() => setAuthNotice('')}
            onSwitch={() => { clearError(); setAuthNotice(''); navigate('/register'); }}
          />
        } />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // ── Authenticated: loading ──
  if (appState === 'checking') return <Spinner />;

  // ── Authenticated but not onboarded (และยังไม่มีบัญชี): welcome page ──
  const needsOnboarding = !onboarded && accounts.length === 0;
  if (needsOnboarding) {
    return (
      <Routes>
        <Route path="/welcome" element={
          <SetupAccountPage onComplete={async () => {
            try { await profileApi.update({ onboarded: true }); } catch {}
            setOnboarded(true);
            navigate('/dashboard');
          }} />
        } />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  // ── Full app ──
  const isAssistant = location.pathname === VIEW_TO_PATH.assistant;
  const currentView = PATH_TO_VIEW[location.pathname] || 'analytics';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F6FAFC] dark:bg-slate-900 transition-colors">
      <Navbar
        view={currentView}
        setView={goView}
        accounts={accounts}
        notifications={notiList}
        onNotificationRefresh={refreshNotifications}
        onRefreshAccounts={refreshAccounts}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        avatarUrl={avatarUrl}
      />
      <main className={`flex-1 min-w-0 ${isAssistant ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
        <Routes>
          <Route path="/assistant" element={
            <AssistantView
              accounts={accounts}
              categories={categories}
              notifications={notiList}
              onGoAccounts={() => goView('accounts')}
              onGoGoals={() => goView('goals')}
              onGoProfile={() => goView('profile')}
              onRefresh={async () => {
                await Promise.all([refreshAccounts(), refreshNotifications()]);
                setQuickEntryRefreshKey((v) => v + 1);
              }}
            />
          } />

          <Route path="/dashboard" element={
            <Container>
              <AnalyticsView
                accounts={accounts}
                categories={categories}
                onGoProfile={() => goView('profile')}
                onGoAccounts={() => goView('accounts')}
                onGoBudgets={() => goView('budgets')}
                onGoGoals={() => goView('goals')}
                isDarkMode={isDarkMode}
                quickEntryRefreshKey={quickEntryRefreshKey}
              />
            </Container>
          } />

          <Route path="/accounts" element={
            <Container>
              <AccountsView
                accounts={accounts}
                onRefresh={refreshAccounts}
                onGoTransactions={(accId) => { setInitialAccountId(accId); goView('transactions'); }}
              />
            </Container>
          } />

          <Route path="/transactions" element={
            <Container>
              <TransactionsView
                accounts={accounts}
                categories={categories}
                onRefreshAccounts={refreshAccounts}
                onNotificationRefresh={refreshNotifications}
                onGoAccounts={() => goView('accounts')}
                initialAccountId={initialAccountId}
                onClearInitialAccountId={() => setInitialAccountId(null)}
                quickEntryRefreshKey={quickEntryRefreshKey}
              />
            </Container>
          } />

          <Route path="/budgets" element={
            <Container><BudgetsView categories={categories} /></Container>
          } />

          <Route path="/goals" element={
            <Container>
              <GoalsView accounts={accounts} onRefreshAccounts={refreshAccounts} quickEntryRefreshKey={quickEntryRefreshKey} />
            </Container>
          } />

          <Route path="/recurring" element={
            <Container>
              <RecurringView
                accounts={accounts}
                categories={categories}
                onNotificationRefresh={refreshNotifications}
              />
            </Container>
          } />

          <Route path="/categories" element={
            <Container><CategoriesView onRefresh={refreshCategories} /></Container>
          } />

          <Route path="/profile" element={
            <Container><ProfileView /></Container>
          } />

          {/* auth/onboarding paths → กลับเข้าแอป */}
          <Route path="/welcome"  element={<Navigate to="/dashboard" replace />} />
          <Route path="/login"    element={<Navigate to="/dashboard" replace />} />
          <Route path="/register" element={<Navigate to="/dashboard" replace />} />
          <Route path="*"         element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

// ─── Root: wrap with AuthProvider ────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <SnackbarProvider>
        <AppShell />
      </SnackbarProvider>
    </AuthProvider>
  );
}
