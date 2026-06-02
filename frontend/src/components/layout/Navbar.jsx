import { useState, useEffect, useRef } from 'react';
import { 
  MessageCircle, LayoutDashboard, Wallet, ArrowLeftRight, RefreshCw, Tag, 
  ChartPie, PiggyBank, Bell, Sun, Moon, LogOut, User, ChevronDown,
  Menu, X
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { profile as profileApi } from '../../services/api';
import NotificationPanel from './NotificationPanel';


const accent = '#2C6488';

export default function Navbar({ 
  view, 
  setView, 
  accounts = [], 
  notifications = [], 
  onNotificationRefresh, 
  onRefreshAccounts, 
  isDarkMode, 
  onToggleDarkMode,
  avatarUrl: propAvatarUrl
}) {
  const { user, logout } = useAuth();
  const initials = (user?.username || '?').slice(0, 2).toUpperCase();
  
  const [avatarUrl, setAvatarUrl] = useState(propAvatarUrl || '');
  const [showNotiPanel, setShowNotiPanel] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  
  // Hover states for dropdown groups
  const [activeDropdown, setActiveDropdown] = useState(null); // 'accounts_transactions' | 'budgets_goals' | null
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (!propAvatarUrl) {
      profileApi.get()
        .then((p) => { if (p?.avatar_url) setAvatarUrl(p.avatar_url); })
        .catch(() => {});
    } else {
      setAvatarUrl(propAvatarUrl);
    }
  }, [propAvatarUrl]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = (notifications || []).filter((n) => !n.is_read).length;

  // Active styles helpers
  const getTabClass = (tabIds) => {
    const isTabActive = Array.isArray(tabIds) ? tabIds.includes(view) : view === tabIds;
    return `relative flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all duration-250 cursor-pointer select-none ${
      isTabActive 
        ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-700/60 dark:text-[#4da2db]' 
        : 'text-slate-600 hover:text-[#2C6488] dark:text-slate-350 dark:hover:text-[#4da2db] hover:bg-slate-50 dark:hover:bg-slate-800/40'
    }`;
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-white/80 backdrop-blur-md border-slate-100 dark:bg-slate-900/80 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Left: Brand Logo & Title */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setView('analytics')}
            className="flex items-center gap-2 focus:outline-none"
          >
            <img 
              src="/images/Logo_PaoJot.png" 
              alt="PaoJot" 
              className="w-8 h-8 rounded-xl object-cover"
            />
            <span className="text-xl font-bold tracking-tight text-[#2C6488] dark:text-white">PaoJot</span>
          </button>
        </div>

        {/* Center: Grouped Nav Menu Links */}
        <nav className="hidden md:flex items-center gap-1.5 relative">
          
          {/* 1. Chat */}
          <button 
            onClick={() => { setView('assistant'); setActiveDropdown(null); }}
            className={getTabClass('assistant')}
          >
            <MessageCircle size={16} />
            <span>แชท</span>
          </button>

          {/* 2. Dashboard */}
          <button 
            onClick={() => { setView('analytics'); setActiveDropdown(null); }}
            className={getTabClass('analytics')}
          >
            <LayoutDashboard size={16} />
            <span>แดชบอร์ด</span>
          </button>

          {/* 3. Dropdown Group: Accounts & Transactions */}
          <div 
            className="relative"
            onMouseEnter={() => setActiveDropdown('accounts_transactions')}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button 
              className={getTabClass(['accounts', 'transactions', 'recurring', 'categories'])}
            >
              <Wallet size={16} />
              <span>บัญชี & รายการ</span>
              <ChevronDown size={12} className={`transition-transform duration-200 ${activeDropdown === 'accounts_transactions' ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Card */}
            {activeDropdown === 'accounts_transactions' && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 w-80 animate-fade-in z-50">
                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-xl rounded-2xl p-2 space-y-1">
                  
                  <button 
                    onClick={() => { setView('accounts'); setActiveDropdown(null); }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-start gap-3 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-slate-700 flex items-center justify-center text-[#2C6488] dark:text-[#4da2db]">
                      <Wallet size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-[#2C6488] dark:group-hover:text-[#4da2db]">บัญชีการเงิน</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">จัดการกระเป๋าเงิน บัตร และบัญชีธนาคาร</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => { setView('transactions'); setActiveDropdown(null); }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-start gap-3 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-slate-700 flex items-center justify-center text-emerald-500">
                      <ArrowLeftRight size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-500">รายการธุรกรรม</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">ประวัติการรับจ่ายและโอนเงินทั้งหมด</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => { setView('recurring'); setActiveDropdown(null); }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-start gap-3 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-slate-700 flex items-center justify-center text-indigo-500">
                      <RefreshCw size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-indigo-500">รายการประจำ</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">ธุรกรรมโอนออก/เข้าประจำเกิดซ้ำ</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => { setView('categories'); setActiveDropdown(null); }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-start gap-3 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-pink-50 dark:bg-slate-700 flex items-center justify-center text-pink-500">
                      <Tag size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-pink-500">ตั้งค่าหมวดหมู่</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">จัดการไอคอนและประเภทหมวดหมู่สี</p>
                    </div>
                  </button>

                </div>
              </div>
            )}
          </div>

          {/* 4. Dropdown Group: Budgets & Goals */}
          <div 
            className="relative"
            onMouseEnter={() => setActiveDropdown('budgets_goals')}
            onMouseLeave={() => setActiveDropdown(null)}
          >
            <button 
              className={getTabClass(['budgets', 'goals'])}
            >
              <ChartPie size={16} />
              <span>งบประมาณ & เป้าหมาย</span>
              <ChevronDown size={12} className={`transition-transform duration-200 ${activeDropdown === 'budgets_goals' ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Card */}
            {activeDropdown === 'budgets_goals' && (
              <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 w-80 animate-fade-in z-50">
                <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-xl rounded-2xl p-2 space-y-1">
                  
                  <button 
                    onClick={() => { setView('budgets'); setActiveDropdown(null); }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-start gap-3 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-slate-700 flex items-center justify-center text-amber-500">
                      <ChartPie size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-amber-500">งบประมาณรายจ่าย</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">จำกัดควบคุมแผนรายจ่ายแยกหมวดหมู่</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => { setView('goals'); setActiveDropdown(null); }}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-start gap-3 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-slate-700 flex items-center justify-center text-teal-500">
                      <PiggyBank size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-teal-500">เป้าหมายการออม</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">วางแผนและติดตามเป้าหมายการเก็บเงิน</p>
                    </div>
                  </button>

                </div>
              </div>
            )}
          </div>

        </nav>

        {/* Right: Quick Controls, Notification bell, Avatar */}
        <div className="flex items-center gap-3">
          
          {/* Hamburger Menu Toggle on Mobile */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors md:hidden focus:outline-none"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Light/Dark Toggle */}
          <button 
            onClick={onToggleDarkMode}
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={isDarkMode ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
          >
            {isDarkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          {/* Notifications Panel */}
          <div className="relative">
            <button 
              onClick={async () => {
                if (!showNotiPanel) await onNotificationRefresh?.();
                setShowNotiPanel((v) => !v);
              }}
              className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] rounded-full bg-[#ef4444] text-[8px] font-bold text-white flex items-center justify-center px-0.5">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotiPanel && (
              <NotificationPanel 
                list={notifications}
                onClose={() => setShowNotiPanel(false)}
                onRefresh={onNotificationRefresh}
                onRefreshAccounts={onRefreshAccounts}
              />
            )}
          </div>

          {/* User Profile Avatar with dropdown */}
          <div className="relative" ref={profileMenuRef}>
            <button 
              onClick={() => setShowProfileMenu((v) => !v)}
              className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-white text-xs font-bold ring-2 ring-offset-2 ring-transparent hover:ring-slate-350 dark:hover:ring-slate-700 transition-all focus:outline-none"
              style={avatarUrl ? {} : { background: accent }}
            >
              {avatarUrl ? (
                <img 
                  src={avatarUrl} 
                  alt="avatar" 
                  className="w-full h-full object-cover" 
                  onError={() => setAvatarUrl('')} 
                />
              ) : initials}
            </button>

            {/* Profile Dropdown Menu */}
            {showProfileMenu && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-xl rounded-2xl p-2 space-y-1 z-50 animate-fade-in">
                
                <div className="px-3 py-2 border-b border-slate-50 dark:border-slate-700/50 mb-1">
                  <p className="text-[10px] text-slate-400 font-medium">เข้าใช้งานโดย</p>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{user?.username || '—'}</p>
                </div>

                <button 
                  onClick={() => { setView('profile'); setShowProfileMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300 hover:text-[#2C6488] dark:hover:text-[#4da2db] text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <User size={14} />
                  <span>โปรไฟล์ของคุณ</span>
                </button>

                <button 
                  onClick={() => { logout(); setShowProfileMenu(false); }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 text-slate-400 hover:text-red-500 text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <LogOut size={14} />
                  <span>ออกจากระบบ</span>
                </button>

              </div>
            )}
          </div>

        </div>

      </div>

      {/* Mobile Menu Panel */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-4 pt-2 pb-6 space-y-4 max-h-[calc(100vh-4rem)] overflow-y-auto transition-colors">
          
          {/* 1. Main Navigation */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider px-3 mb-1">เมนูหลัก</p>
            <button
              onClick={() => { setView('assistant'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                view === 'assistant' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db]' 
                  : 'text-slate-655 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50'
              }`}
            >
              <MessageCircle size={18} />
              <span>แชท</span>
            </button>
            <button
              onClick={() => { setView('analytics'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                view === 'analytics' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db]' 
                  : 'text-slate-655 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50'
              }`}
            >
              <LayoutDashboard size={18} />
              <span>แดชบอร์ด</span>
            </button>
          </div>

          {/* 2. Accounts & Transactions */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider px-3 mb-1">บัญชี & รายการ</p>
            <button
              onClick={() => { setView('accounts'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                view === 'accounts' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db] font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-800/50'
              }`}
            >
              <Wallet size={16} />
              <span>บัญชีการเงิน</span>
            </button>
            <button
              onClick={() => { setView('transactions'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                view === 'transactions' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db] font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-800/50'
              }`}
            >
              <ArrowLeftRight size={16} />
              <span>รายการธุรกรรม</span>
            </button>
            <button
              onClick={() => { setView('recurring'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                view === 'recurring' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db] font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-800/50'
              }`}
            >
              <RefreshCw size={16} />
              <span>รายการประจำ</span>
            </button>
            <button
              onClick={() => { setView('categories'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                view === 'categories' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db] font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-800/50'
              }`}
            >
              <Tag size={16} />
              <span>ตั้งค่าหมวดหมู่</span>
            </button>
          </div>

          {/* 3. Budgets & Goals */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider px-3 mb-1">งบประมาณ & เป้าหมาย</p>
            <button
              onClick={() => { setView('budgets'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                view === 'budgets' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db] font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-800/50'
              }`}
            >
              <ChartPie size={16} />
              <span>งบประมาณรายจ่าย</span>
            </button>
            <button
              onClick={() => { setView('goals'); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                view === 'goals' 
                  ? 'bg-[#EAF3F7] text-[#2C6488] dark:bg-slate-800 dark:text-[#4da2db] font-bold' 
                  : 'text-slate-600 hover:bg-slate-50 dark:text-slate-350 dark:hover:bg-slate-800/50'
              }`}
            >
              <PiggyBank size={16} />
              <span>เป้าหมายการออม</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
