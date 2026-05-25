import { useState, useEffect } from 'react';
import { Bell, Sun, Moon } from 'lucide-react';
import NotificationPanel from './NotificationPanel';
import { useAuth } from '../../contexts/AuthContext';
import { profile as profileApi } from '../../services/api';
import { formatDisplayDate } from '../../utils/dateFormat';

const accent = '#2C6488';

export default function Topbar({ pageTitle, onProfile, notifications, onNotificationRefresh, onRefreshAccounts, isDarkMode, onToggleDarkMode }) {
  const { user } = useAuth();
  const initials  = (user?.username || '?').slice(0, 2).toUpperCase();
  const [showPanel, setShowPanel] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');

  useEffect(() => {
    profileApi.get()
      .then((p) => { if (p?.avatar_url) setAvatarUrl(p.avatar_url); })
      .catch(() => {});
  }, []);

  const unreadCount = (notifications || []).filter((n) => !n.is_read).length;

  const today = formatDisplayDate(new Date());

  return (
    <header className="flex-shrink-0 border-b px-6 py-4 flex items-center justify-between bg-white border-slate-100 shadow-sm">
      <div>
        <h1 className="text-lg font-bold text-slate-800">{pageTitle}</h1>
        <p className="text-xs text-slate-400 mt-0.5">{today}</p>
      </div>
      <div className="flex items-center gap-3">
        {/* Theme Toggle Button */}
        <button
          onClick={onToggleDarkMode}
          className="p-2.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
          title={isDarkMode ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
        >
          {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Bell icon */}
        <div className="relative">
          <button
            onClick={() => setShowPanel((v) => !v)}
            className="relative p-2.5 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span
                className="absolute top-1 right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1"
                style={{ background: accent }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showPanel && (
            <NotificationPanel
              list={notifications || []}
              onClose={() => setShowPanel(false)}
              onRefresh={onNotificationRefresh}
              onRefreshAccounts={onRefreshAccounts}
            />
          )}
        </div>

        {/* Avatar */}
        <button
          onClick={onProfile}
          title="โปรไฟล์"
          className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-white text-sm font-bold hover:opacity-80 transition-opacity ring-2 ring-offset-1 ring-transparent hover:ring-[#BFD8E4]"
          style={avatarUrl ? {} : { background: accent }}>
          {avatarUrl
            ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
            : initials}
        </button>
      </div>
    </header>
  );
}
