import { useEffect, useRef } from 'react';
import { BellOff, Bot, ChartPie, PiggyBank, RefreshCw, Check } from 'lucide-react';
import { notifications as notiApi } from '../../services/api';
import { formatDisplayDateTime } from '../../utils/dateFormat';

export default function NotificationPanel({ list, onClose, onRefresh, onRefreshAccounts }) {
  const panelRef = useRef(null);

  // ปิด panel เมื่อคลิกนอก
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const confirm = async (id) => {
    try {
      await notiApi.confirm(id);
      await Promise.all([onRefresh(), onRefreshAccounts?.()]);
    } catch (err) { alert(err.message); }
  };

  const skip = async (id) => {
    try {
      await notiApi.skip(id);
      await onRefresh();
    } catch (err) { alert(err.message); }
  };

  const readAll = async () => {
    try {
      await notiApi.readAll();
      await onRefresh();
    } catch {}
  };

  const unreadCount = list.filter((n) => !n.is_read).length;
  const renderIcon = (type) => {
    if (type?.startsWith('budget')) return <ChartPie size={15} color="#f59e0b" />;
    if (type === 'goal_due') return <PiggyBank size={15} color="#10b981" />;
    if (type?.startsWith('ai_')) return <Bot size={15} color="#2C6488" />;
    return <RefreshCw size={15} color="#2C6488" />;
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">การแจ้งเตือน</p>
          {unreadCount > 0 && (
            <p className="text-xs text-slate-400 mt-0.5">{unreadCount} รายการยังไม่อ่าน</p>
          )}
        </div>
        {list.length > 0 && (
          <button onClick={readAll}
            className="text-xs text-[#2C6488] hover:text-[#25536F] font-medium">
            อ่านทั้งหมด
          </button>
        )}
      </div>

      {/* List */}
      <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-50">
        {list.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-slate-400">
            <BellOff size={32} color="#cbd5e1" />
            <p className="text-sm">ไม่มีการแจ้งเตือน</p>
          </div>
        ) : (
          list.map((n) => {
            const isRecurring = (n.notification_type === 'recurring' || !!n.recurring_id) && !n.action_taken;
            const bgColor     = n.is_read ? 'bg-white' : 'bg-[#EAF3F7]/40';

            return (
              <div key={n.id} className={`px-5 py-4 transition-colors ${bgColor}`}>
                {/* Icon + Title */}
                <div className="flex items-start gap-2 mb-3">
                  {/* type icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {renderIcon(n.notification_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {!n.is_read && (
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: '#2C6488' }} />
                      )}
                      <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                    </div>
                    {n.message && (
                      <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
                    )}
                    <p className="text-xs text-slate-300 mt-1">
                      {formatDisplayDateTime(n.created_at)}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                {isRecurring && (
                  <div className="flex gap-2 ml-6">
                    <button onClick={() => confirm(n.id)}
                      className="flex-1 text-xs py-2 rounded-xl font-semibold transition-colors flex items-center justify-center gap-1.5"
                      style={{ background: '#EAF3F7', color: '#2C6488' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#BFD8E4'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#EAF3F7'; }}>
                      <Check size={13} />
                      <span>บันทึกรายการ</span>
                    </button>
                    <button onClick={() => skip(n.id)}
                      className="flex-1 text-xs py-2 rounded-xl font-medium bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors">
                      ข้ามรอบนี้
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
