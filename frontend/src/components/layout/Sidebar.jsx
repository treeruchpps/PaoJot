import { DollarSign, Menu, LogOut } from 'lucide-react';
import Icon from '../common/Icon';
import { NAV, fmt } from '../../constants/data';
import { useAuth } from '../../contexts/AuthContext';

export default function Sidebar({ view, setView, accounts, collapsed, setCollapsed, avatarUrl }) {
  const { user, logout } = useAuth();
  const totalAssets = accounts.filter((a) => a.type === 'asset').reduce((s, a) => s + a.balance, 0);
  const totalLiab   = accounts.filter((a) => a.type === 'liability').reduce((s, a) => s + a.balance, 0);
  const netWorth    = totalAssets - totalLiab;
  const accent = '#3b82f6';
  const initials = user?.username?.slice(0, 1).toUpperCase() || '?';

  return (
    <aside
      className={`flex flex-col ${collapsed ? 'w-16' : 'w-60'} flex-shrink-0 transition-all duration-200 border-r bg-white border-slate-100 shadow-sm`}
    >
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-3">
        <button
          onClick={() => setView('analytics')}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: accent }}>
            <DollarSign size={18} color="white" />
          </div>
          {!collapsed && <span className="text-base font-bold" style={{ color: accent }}>PaoJot</span>}
        </button>
      </div>

      {/* User info */}
      {!collapsed && (
        <div className="mx-3 mb-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-2.5">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={initials}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-white ring-offset-1"
                style={{ boxShadow: `0 0 0 2px ${accent}40` }}
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
            ) : null}
            <div
              className="w-8 h-8 rounded-full items-center justify-center text-white text-sm font-bold ring-2 ring-white ring-offset-1"
              style={{ background: accent, boxShadow: `0 0 0 2px ${accent}40`, display: avatarUrl ? 'none' : 'flex' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{user?.username || '—'}</p>
              <p className="text-xs text-slate-400">฿{fmt(netWorth)} สุทธิ</p>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`sidebar-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
              view === item.id ? 'active font-semibold' : 'text-slate-500 hover:text-slate-800'
            }`}
            style={view === item.id ? { color: accent } : {}}
          >
            <Icon name={item.icon} size={18} color={view === item.id ? accent : undefined} />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-4 space-y-0.5">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="sidebar-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400"
        >
          <Menu size={17} />
          {!collapsed && <span>ย่อแถบเมนู</span>}
        </button>
        <button
          onClick={logout}
          className="sidebar-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-red-500 transition-colors"
        >
          <LogOut size={17} />
          {!collapsed && <span>ออกจากระบบ</span>}
        </button>
      </div>
    </aside>
  );
}
