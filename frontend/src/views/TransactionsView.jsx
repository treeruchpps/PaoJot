import { useState, useEffect, useCallback, useRef } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { ArrowUp, ArrowDown, ArrowLeftRight, Trash2, Edit, Search, X, Download, List, Calendar, Loader2, ChevronDown, DollarSign, Briefcase, Star, Smartphone, TrendingUp, Wallet, Plus } from 'lucide-react';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { transactions as txApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDate } from '../utils/dateFormat';
import { applySavedCategoryOrder } from '../utils/categoryOrder';
import { getTransactionAccounts } from '../utils/accountFilters';

const TYPE_LABEL = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอนเงิน', adjustment: 'ปรับยอด' };
const TYPE_COLOR = { income: '#10b981', expense: '#ef4444', transfer: '#2563eb', adjustment: '#f59e0b' };
const TYPE_BG    = { income: '#f0fdf4', expense: '#fff1f2', transfer: '#eff6ff', adjustment: '#fffbeb' };
const TYPE_ICON  = { income: 'ArrowUp', expense: 'ArrowDown', transfer: 'ArrowLeftRight', adjustment: 'SlidersHorizontal' };
const DAY_TH     = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const TX_PAGE_SIZE = 10;

const pad2 = (n) => String(n).padStart(2, '0');

// ─── Account kind icon ────────────────────────────────────────────────────────
const ACC_KIND_META = {
  cash:         { icon: 'DollarSign', color: '#10b981' },
  bank_account: { icon: 'Briefcase',  color: '#2C6488' },
  savings:      { icon: 'Star',       color: '#f59e0b' },
  e_wallet:     { icon: 'Smartphone', color: '#2C6488' },
  investment:   { icon: 'TrendingUp', color: '#5F9A7A' },
};
function AccKindIcon({ kind, size = 15 }) {
  const m = ACC_KIND_META[kind] || { icon: 'DollarSign', color: '#94a3b8' };
  if (m.icon === 'DollarSign')  return <DollarSign  size={size} color={m.color} />;
  if (m.icon === 'Briefcase')   return <Briefcase   size={size} color={m.color} />;
  if (m.icon === 'Star')        return <Star        size={size} color={m.color} />;
  if (m.icon === 'Smartphone')  return <Smartphone  size={size} color={m.color} />;
  if (m.icon === 'TrendingUp')  return <TrendingUp  size={size} color={m.color} />;
  return null;
}

// ─── Custom Select: หมวดหมู่ (category) ──────────────────────────────────────
function CatSelect({ value, onChange, categories, placeholder = 'เลือกหมวดหมู่' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = categories.find((c) => c.id === value);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 hover:border-[#BFD8E4] transition-colors">
        {selected ? (
          <>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: (selected.color || '#94a3b8') + '25' }}>
              <Icon name={selected.icon} size={13} color={selected.color || '#94a3b8'} />
            </div>
            <span className="flex-1 text-left font-medium truncate">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-slate-400">{placeholder}</span>
        )}
        <ChevronDown size={13} color="#94a3b8"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {categories.map((c) => (
            <button key={c.id} type="button" onClick={() => { onChange(c.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-50 transition-colors"
              style={{ background: value === c.id ? (c.color || '#94a3b8') + '10' : undefined }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: (c.color || '#94a3b8') + '25' }}>
                <Icon name={c.icon} size={13} color={c.color || '#94a3b8'} />
              </div>
              <span className="flex-1 text-left font-medium" style={{ color: value === c.id ? (c.color || '#374151') : '#374151' }}>
                {c.name}
              </span>
              {value === c.id && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color || '#94a3b8' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Custom Select: บัญชี (account) ──────────────────────────────────────────
function AccSelect({ value, onChange, accounts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = accounts.find((a) => a.id === value);
  const km = (kind) => ACC_KIND_META[kind] || { color: '#94a3b8' };
  const balanceColor = () => '#64748b';

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-700 hover:border-[#BFD8E4] transition-colors">
        {selected ? (
          <>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: km(selected.kind).color + '25' }}>
              <AccKindIcon kind={selected.kind} size={13} />
            </div>
            <span className="flex-1 text-left font-medium truncate">{selected.name}</span>
            <span className="text-xs font-semibold flex-shrink-0" style={{ color: balanceColor(selected) }}>
              ฿{fmt(selected.balance)}
            </span>
          </>
        ) : (
          <span className="flex-1 text-left text-slate-400">เลือกบัญชี</span>
        )}
        <ChevronDown size={13} color="#94a3b8"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {accounts.map((a) => (
            <button key={a.id} type="button" onClick={() => { onChange(a.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-50 transition-colors"
              style={{ background: value === a.id ? km(a.kind).color + '10' : undefined }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: km(a.kind).color + '25' }}>
                <AccKindIcon kind={a.kind} size={13} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium truncate" style={{ color: value === a.id ? km(a.kind).color : '#374151' }}>
                  {a.name}
                </p>
                <p className="text-xs font-semibold" style={{ color: balanceColor(a) }}>
                  ฿{fmt(a.balance)}
                </p>
              </div>
              {value === a.id && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: km(a.kind).color }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Custom Select: Filter (generic) ─────────────────────────────────────────
function FilterSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-[#BFD8E4] transition-colors whitespace-nowrap">
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={13} color="#94a3b8"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-full">
          {options.map((o) => (
            <button key={o.value} type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                o.value === value ? 'bg-[#EAF3F7] text-[#2C6488] font-semibold' : 'text-slate-700 hover:bg-slate-50'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Calendar sub-component ──────────────────────────────────────────────────
function CalendarView({ txList, filterMonth, getAcc, getCat, onRemove }) {
  const [selectedDate, setSelectedDate] = useState(null);

  const [y, m] = filterMonth.split('-').map(Number);
  const todayStr  = new Date().toISOString().slice(0, 10);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow    = new Date(y, m - 1, 1).getDay(); // 0=Sun

  // Group txList by date
  const byDate = {};
  txList.forEach((tx) => {
    const d = tx.transaction_date?.slice(0, 10);
    if (d) { if (!byDate[d]) byDate[d] = []; byDate[d].push(tx); }
  });

  // Build calendar cells (null = empty leading cell)
  const cells = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedTxs = selectedDate ? (byDate[selectedDate] || []) : [];

  return (
    <div className="space-y-4">
      {/* Calendar grid */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
          {DAY_TH.map((d, i) => (
            <div key={i} className={`py-2.5 text-center text-xs font-semibold
              ${i === 0 ? 'text-red-400' : i === 6 ? 'text-[#6F9DB6]' : 'text-slate-500'}`}>
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 divide-x divide-y divide-slate-50">
          {cells.map((day, idx) => {
            if (!day) return (
              <div key={idx} className="h-24 bg-slate-50/40" />
            );

            const dateStr = `${y}-${pad2(m)}-${pad2(day)}`;
            const txs     = byDate[dateStr] || [];
            const inc     = txs.filter((t) => t.type === 'income').reduce((s, t)  => s + t.amount, 0);
            const exp     = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            const isToday    = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const dow = (firstDow + day - 1) % 7;

            return (
              <button key={idx}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`h-24 p-2 text-left transition-colors border-0
                  ${isSelected ? 'bg-[#EAF3F7] ring-2 ring-inset ring-[#BFD8E4]' : 'hover:bg-slate-50'}`}
              >
                {/* Day number */}
                <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1
                  ${isToday
                    ? 'bg-[#2C6488] text-white'
                    : dow === 0
                      ? 'text-red-400'
                      : dow === 6
                        ? 'text-[#6F9DB6]'
                        : 'text-slate-600'}`}>
                  {day}
                </span>

                {/* Income / Expense amounts */}
                {txs.length > 0 && (
                  <div className="space-y-0.5">
                    {inc > 0 && (
                      <p className="text-xs font-semibold text-emerald-600 leading-tight truncate">
                        +{fmt(inc)}
                      </p>
                    )}
                    {exp > 0 && (
                      <p className="text-xs font-semibold text-red-500 leading-tight truncate">
                        -{fmt(exp)}
                      </p>
                    )}
                    {/* Type dots */}
                    <div className="flex gap-0.5 mt-1 flex-wrap">
                      {txs.slice(0, 4).map((tx, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: TYPE_COLOR[tx.type] || '#94a3b8' }} />
                      ))}
                      {txs.length > 4 && (
                        <span className="text-xs text-slate-400 leading-none">+{txs.length - 4}</span>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              รายการวันที่ {formatDisplayDate(selectedDate)}
            </p>
            <span className="text-xs text-slate-400">{selectedTxs.length} รายการ</span>
          </div>
          {selectedTxs.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">ไม่มีรายการในวันนี้</div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {selectedTxs.map((tx) => {
                  const cat   = getCat(tx.category_id);
                  const acc   = getAcc(tx.account_id);
                  const toAcc = getAcc(tx.to_account_id);
                  return (
                    <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-700 font-medium">{tx.name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                          style={{ color: TYPE_COLOR[tx.type], background: TYPE_BG[tx.type] }}>
                          {TYPE_LABEL[tx.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cat ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                              style={{ background: (cat.color || '#2C6488') + '22' }}>
                              <Icon name={cat.icon || 'Tag'} size={11} color={cat.color || '#2C6488'} />
                            </div>
                            <span className="text-xs text-slate-700">{cat.name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {tx.type === 'transfer'
                          ? `${acc?.name || '?'} → ${toAcc?.name || '?'}`
                          : acc?.name || '?'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{tx.note || '—'}</td>
                      <td className="px-4 py-3 text-center font-semibold whitespace-nowrap"
                        style={{ color: TYPE_COLOR[tx.type] }}>
                        {tx.type === 'expense' ? '-' : tx.type === 'adjustment' ? '' : '+'}฿{fmt(tx.amount)}
                      </td>
                      <td className="px-4 py-2">
                        <button onClick={() => onRemove(tx.id)}
                          className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
                          <Trash2 size={11} color="#94a3b8" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function TransactionsView({ accounts, categories, onRefreshAccounts, onNotificationRefresh, onGoAccounts, initialAccountId, onClearInitialAccountId, quickEntryRefreshKey = 0 }) {
  const { showError } = useSnackbar();
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const thisYear  = today.slice(0, 4);
  const transactionAccounts = getTransactionAccounts(accounts || []);
  const defaultAccountId = transactionAccounts[0]?.id || '';
  const defaultToAccountId = transactionAccounts[1]?.id || transactionAccounts[0]?.id || '';
  const transactionAccountIds = new Set(transactionAccounts.map((a) => a.id));
  const weekStartDate = (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  })();
  const weekEndDate = (() => {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const hasAccounts = transactionAccounts.length > 0;

  const [txList,       setTxList]       = useState([]);
  const [txMeta,       setTxMeta]       = useState({ total: 0, total_income: 0, total_expense: 0 });
  const [loading,      setLoading]      = useState(true);
  const [exporting,    setExporting]    = useState(false);
  const [viewMode,     setViewMode]     = useState('list');   // 'list' | 'calendar'
  const [addMenuOpen,  setAddMenuOpen]  = useState(false);
  const [showModal,    setShowModal]    = useState(false);
  const [txType,       setTxType]       = useState('expense');
  const [filterMonth,  setFilterMonth]  = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(thisMonth);
  const [filterType,   setFilterType]   = useState('all');
  const [filterAcc,    setFilterAcc]    = useState(initialAccountId || 'all');
  const [search,       setSearch]       = useState('');

  useEffect(() => {
    if (initialAccountId) {
      setFilterAcc(initialAccountId);
      onClearInitialAccountId?.();
    }
  }, [initialAccountId, onClearInitialAccountId]);
  const [sortBy,       setSortBy]       = useState('date');
  const [sortDir,      setSortDir]      = useState('desc');
  const [currentPage,  setCurrentPage]  = useState(1);
  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
    setCurrentPage(1);
  };
  const [form, setForm] = useState({
    name: '', amount: '', note: '', category_id: '',
    account_id:       defaultAccountId,
    from_account_id:  defaultAccountId,
    to_account_id:    defaultToAccountId,
    transaction_date: today,
  });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null); // null = create, uuid = edit

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch (no pagination: limit=1000) ────────────────────────────────────
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAcc] = useState(null);
  const [adjustBalance, setAdjustBalance] = useState('');
  const [adjustSaving] = useState(false);

  const saveAdjust = () => {
    showError('รายการปรับยอดแก้ไขไม่ได้ หากยอดผิดให้ลบบัญชีแล้วสร้างใหม่');
  };

  const getAvailableForOutflow = (accountId, currentTx = null) => {
    const account = accounts.find((a) => a.id === accountId);
    let available = Number(account?.balance || 0);
    if (currentTx?.account_id === accountId && (currentTx.type === 'expense' || currentTx.type === 'transfer')) {
      available += Number(currentTx.amount || 0);
    }
    return available;
  };

  const buildTxListParams = useCallback((overrides = {}) => {
    const params = {
      page: viewMode === 'calendar' ? 1 : currentPage,
      limit: viewMode === 'calendar' ? 10000 : TX_PAGE_SIZE,
      sort_by: sortBy,
      sort_dir: sortDir,
      ...overrides,
    };
    if (filterMonth === 'today') {
      params.date_from = today;
      params.date_to = today;
    } else if (filterMonth === 'week') {
      params.date_from = weekStartDate;
      params.date_to = weekEndDate;
    } else if (filterMonth === 'month') {
      const [y, m] = selectedMonth.split('-');
      const dateFrom = `${y}-${m}-01`;
      const lastDay  = new Date(parseInt(y), parseInt(m), 0).getDate();
      const dateTo   = `${y}-${m}-${pad2(lastDay)}`;
      params.date_from = dateFrom;
      params.date_to = dateTo;
    } else if (filterMonth === 'year') {
      params.date_from = `${thisYear}-01-01`;
      params.date_to = `${thisYear}-12-31`;
    }
    if (filterType !== 'all') params.type       = filterType;
    if (filterAcc  !== 'all') params.account_id = filterAcc;
    if (search.trim()) params.search = search.trim();
    return params;
  }, [filterMonth, filterType, filterAcc, today, weekStartDate, weekEndDate, selectedMonth, thisYear, viewMode, currentPage, sortBy, sortDir, search]);

  const fetchTx = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildTxListParams();
      const res = await txApi.list(params);
      setTxList(res?.data || []);
      setTxMeta({
        total: Number(res?.total || 0),
        total_income: Number(res?.total_income || 0),
        total_expense: Number(res?.total_expense || 0),
      });
    } catch {
      setTxList([]);
      setTxMeta({ total: 0, total_income: 0, total_expense: 0 });
    } finally {
      setLoading(false);
    }
  }, [buildTxListParams]);

  useEffect(() => { fetchTx(); }, [fetchTx]);
  useEffect(() => {
    if (quickEntryRefreshKey > 0) fetchTx();
  }, [quickEntryRefreshKey, fetchTx]);

  // ── Categories ───────────────────────────────────────────────────────────
  const expCats      = applySavedCategoryOrder('expense', (categories || []).filter((c) => c.type === 'expense'));
  const incCats      = applySavedCategoryOrder('income', (categories || []).filter((c) => c.type === 'income'));
  const transferCats = applySavedCategoryOrder('transfer', (categories || []).filter((c) => c.type === 'transfer'));

  const currentCats = txType === 'income'
    ? incCats
    : txType === 'transfer'
      ? transferCats
      : expCats;

  const changeModalType = (nextType) => {
    if (nextType === txType) return;
    const cats = nextType === 'income' ? incCats : expCats;
    setTxType(nextType);
    setForm((prev) => ({
      ...prev,
      category_id: cats[0]?.id || '',
    }));
    };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getAcc = (id) => accounts.find((a) => a.id === id);
  const getCat = (id) => (categories || []).find((c) => c.id === id);

  // ── Add transaction ───────────────────────────────────────────────────────
  const openAdd = (type) => {
    if (!hasAccounts) return;
    setTxType(type);
    setEditId(null);
    const cats = type === 'income'
      ? incCats
      : type === 'transfer'
        ? transferCats
        : expCats;
    setForm({
      name: '', amount: '', note: '',
      category_id:      cats[0]?.id || '',
      account_id:       defaultAccountId,
      from_account_id:  defaultAccountId,
      to_account_id:    defaultToAccountId,
      transaction_date: today,
    });
    setShowModal(true);
  };

  // ── Edit transaction ──────────────────────────────────────────────────────
  const openEdit = (tx) => {
    // Adjustment → เปิด modal ปรับยอดบัญชีตรงๆ เหมือนหน้าบัญชี/กระเป๋าเงิน
    if (tx.type === 'adjustment') return;
    const cats = tx.type === 'income'
      ? incCats
      : tx.type === 'transfer'
        ? transferCats
        : expCats;
    setTxType(tx.type);
    setEditId(tx.id);
    setForm({
      name:             tx.name  || '',
      amount:           String(tx.amount),
      note:             tx.note  || '',
      category_id:      tx.category_id      || cats[0]?.id || '',
      account_id:       tx.account_id       || defaultAccountId,
      from_account_id:  tx.account_id       || defaultAccountId,
      to_account_id:    tx.to_account_id    || defaultToAccountId,
      transaction_date: tx.transaction_date?.slice(0, 10) || today,
    });
    setShowModal(true);
  };

  // ── Save adjust balance ───────────────────────────────────────────────────
  const save = async () => {
    const amount = parseFloat(form.amount);
    if (!form.amount || amount <= 0) { showError('กรุณาใส่จำนวนเงิน'); return; }
    if (!form.category_id) { showError('กรุณาเลือกหมวดหมู่'); return; }
    if (txType === 'transfer') {
      if (!transactionAccountIds.has(form.from_account_id) || !transactionAccountIds.has(form.to_account_id)) {
        showError('กรุณาเลือกบัญชีที่ใช้บันทึกรายการได้');
        return;
      }
    } else if (!transactionAccountIds.has(form.account_id)) {
      showError('กรุณาเลือกบัญชีที่ใช้บันทึกรายการได้');
      return;
    }
    if (txType === 'transfer' && form.from_account_id === form.to_account_id) {
      showError('บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน');
      return;
    }
    const oldTx = editId ? txList.find((tx) => tx.id === editId) : null;
    const outflowAccountId = txType === 'transfer' ? form.from_account_id : txType === 'expense' ? form.account_id : null;
    if (outflowAccountId) {
      const available = getAvailableForOutflow(outflowAccountId, oldTx);
      if (amount > available) {
        showError(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(available)}`);
        return;
      }
    }
    setSaving(true);
    try {
      const body = {
        type:             txType,
        amount,
        name:             form.name || null,
        note:             form.note || null,
        transaction_date: form.transaction_date,
      };
      if (txType === 'transfer') {
        body.account_id    = form.from_account_id;
        body.to_account_id = form.to_account_id;
        body.category_id   = form.category_id;
      } else {
        body.account_id  = form.account_id;
        body.category_id = form.category_id;
      }
      if (editId) {
        await txApi.update(editId, body);
      } else {
        await txApi.create(body);
      }
      await Promise.all([fetchTx(), onRefreshAccounts?.(), onNotificationRefresh?.()]);
      setEditId(null);
      setShowModal(false);
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await txApi.delete(deleteTarget.id);
      await Promise.all([fetchTx(), onRefreshAccounts?.(), onNotificationRefresh?.()]);
      setDeleteTarget(null);
    } catch (err) { alert(err.message); }
    finally { setDeleting(false); }
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const firstPage = await txApi.list(buildTxListParams({ page: 1, limit: 10000 }));
      const total = Number(firstPage?.total || 0);
      let exportList = firstPage?.data || [];

      for (let page = 2; exportList.length < total; page += 1) {
        const res = await txApi.list(buildTxListParams({ page, limit: 10000 }));
        const data = res?.data || [];
        if (data.length === 0) break;
        exportList = [...exportList, ...data];
      }

    const headers = ['วันที่', 'ประเภท', 'หมวดหมู่', 'บัญชี', 'หมายเหตุ', 'จำนวน (฿)'];
    const rows = exportList.map((tx) => {
      const cat   = getCat(tx.category_id);
      const acc   = getAcc(tx.account_id);
      const toAcc = getAcc(tx.to_account_id);
      const sign  = tx.type === 'expense' ? '-' : tx.type === 'adjustment' ? '' : '+';
      return [
        formatDisplayDate(tx.transaction_date, ''),
        TYPE_LABEL[tx.type] || tx.type,
        cat?.name || '',
        tx.type === 'transfer'
          ? `${acc?.name || ''} → ${toAcc?.name || ''}`
          : acc?.name || '',
        tx.note || '',
        `${sign}${tx.amount}`,
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    // \uFEFF = UTF-8 BOM so Excel can read Thai correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `transactions_${filterMonth === 'month' ? selectedMonth : filterMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Export CSV ไม่สำเร็จ');
    } finally {
      setExporting(false);
    }
  };

  const displayList = txList || [];
  const totalRows = viewMode === 'calendar' ? displayList.length : Number(txMeta.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalRows / TX_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * TX_PAGE_SIZE;
  const paginatedList = displayList;
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((page) => totalPages <= 7 || page === 1 || page === totalPages || Math.abs(page - safePage) <= 1);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterMonth, selectedMonth, filterType, filterAcc, search, sortBy, sortDir, viewMode]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  // ── Summary (from transactions) ───────────────────────────────────────────
  const totalIncome  = Number(txMeta.total_income || 0);
  const totalExpense = Number(txMeta.total_expense || 0);
  const SortHeader = ({ label, sortKey, align = 'left' }) => {
    const active = sortBy === sortKey;
    return (
      <button type="button" onClick={() => toggleSort(sortKey)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${align === 'center' ? 'justify-center' : 'justify-start'} ${active ? 'text-[#2C6488]' : 'text-slate-500'} hover:text-[#2C6488]`}>
        <span>{label}</span>
        <span className={`w-5 h-5 rounded-md flex items-center justify-center border ${active ? 'bg-[#EAF3F7] border-[#BFD8E4]' : 'bg-white border-slate-200'}`}>
          {active
            ? sortDir === 'asc'
              ? <ArrowUp size={13} color="#2C6488" strokeWidth={2.6} />
              : <ArrowDown size={13} color="#2C6488" strokeWidth={2.6} />
            : <ArrowDown size={13} color="#94a3b8" strokeWidth={2.3} />}
        </span>
      </button>
    );
  };

  return (
    <div className="p-6 space-y-5">

      <div className="rounded-2xl border border-[#2C6488]/10 bg-[#EAF3F7] p-4 space-y-3">
        <h2 className="text-base font-semibold text-slate-700">ภาพรวมรายการธุรกรรม</h2>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'รายได้',  value: totalIncome,  color: '#10b981', bg: '#f0fdf4' },
            { label: 'รายจ่าย', value: totalExpense, color: '#ef4444', bg: '#fff1f2' },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl p-4 bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">{s.label}</p>
              <p className="text-xl font-bold" style={{ color: s.color }}>
                ฿{fmt(s.value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-slate-700">ประวัติรายการ</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
            {[
              { mode: 'list',     Icon: List,     title: 'รายการ' },
              { mode: 'calendar', Icon: Calendar, title: 'ปฏิทิน' },
            ].map(({ mode, Icon: IconComponent, title }) => (
              <button key={mode} onClick={() => setViewMode(mode)} title={title}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  viewMode === mode ? 'bg-white shadow-sm text-[#2C6488]' : 'text-slate-400 hover:text-slate-600'
                }`}>
                <IconComponent size={15} color={viewMode === mode ? '#2C6488' : '#94a3b8'} />
              </button>
            ))}
          </div>

          {/* Add menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => hasAccounts && setAddMenuOpen((open) => !open)}
              disabled={!hasAccounts}
              title={!hasAccounts ? 'ต้องสร้างบัญชีก่อน' : ''}
              className={`text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F] ${!hasAccounts ? 'opacity-45 cursor-not-allowed hover:bg-[#2C6488] hover:border-[#2C6488]' : ''}`}
            >
              <Plus size={13} color="#ffffff" />
              เพิ่มรายการ
              <ChevronDown size={13} color="#ffffff" className={`transition-transform ${addMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {addMenuOpen && hasAccounts && (
              <div className="absolute right-0 top-full z-30 mt-2 w-44 rounded-2xl border border-slate-100 bg-white p-1.5 shadow-lg">
                {['expense', 'income', 'transfer'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setAddMenuOpen(false); openAdd(t); }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 flex items-center gap-2 hover:bg-[#EAF3F7] transition-colors"
                  >
                    {TYPE_ICON[t] === 'ArrowUp' && <ArrowUp size={14} color={TYPE_COLOR[t]} />}
                    {TYPE_ICON[t] === 'ArrowDown' && <ArrowDown size={14} color={TYPE_COLOR[t]} />}
                    {TYPE_ICON[t] === 'ArrowLeftRight' && <ArrowLeftRight size={14} color={TYPE_COLOR[t]} />}
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Export CSV */}
          <button onClick={exportCSV} disabled={exporting}
            className="text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-wait">
            {exporting ? <Loader2 size={13} color="#64748b" className="animate-spin" /> : <Download size={13} color="#64748b" />}
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {!hasAccounts && (
        <div className="rounded-2xl border border-[#DCE8EE] bg-[#EAF3F7] px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center flex-shrink-0">
              <Wallet size={22} color="#2C6488" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">ยังไม่มีบัญชีสำหรับบันทึกรายการ</p>
              <p className="text-xs text-slate-500 mt-0.5">
                สร้างบัญชีก่อนเพื่อเลือกว่ารายรับ รายจ่าย หรือการโอนเงินนี้เกิดกับบัญชีไหน
              </p>
            </div>
          </div>
          <button onClick={onGoAccounts}
            className="flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] transition-colors">
            ไปสร้างบัญชี
          </button>
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <FilterSelect
          value={filterMonth}
          onChange={setFilterMonth}
          options={[
            { value: 'today', label: 'วันนี้' },
            { value: 'week',  label: 'สัปดาห์นี้' },
            { value: 'month', label: 'เดือนนี้' },
            { value: 'year',  label: 'ปีนี้' },
            { value: 'all',   label: 'รายการทั้งหมด' },
          ]}
        />
        {filterMonth === 'month' && (
          <input type="month" value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700" />
        )}
        <FilterSelect
          value={filterType}
          onChange={setFilterType}
          options={[
            { value: 'all',        label: 'ทุกประเภท' },
            { value: 'income',     label: 'รายรับ' },
            { value: 'expense',    label: 'รายจ่าย' },
            { value: 'transfer',   label: 'โอนเงิน' },
            { value: 'adjustment', label: 'ปรับยอด' },
          ]}
        />
        <FilterSelect
          value={filterAcc}
          onChange={setFilterAcc}
          options={[
            { value: 'all', label: 'ทุกบัญชี' },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />

        {/* Search box */}
        <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 bg-white flex-1 min-w-48">
          <Search size={14} color="#94a3b8" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อรายการ, หมายเหตุ, จำนวน..."
            className="bg-transparent text-sm text-slate-700 placeholder-slate-400 w-full"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-slate-300 hover:text-slate-500">
              <X size={13} color="#94a3b8" />
            </button>
          )}
        </div>

        {txList.length > 0 && (
          <span className="text-xs text-slate-400 whitespace-nowrap">
            {totalRows} รายการ
          </span>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลด...</div>
      ) : viewMode === 'calendar' ? (
        <CalendarView
          txList={txList}
          filterMonth={filterMonth === 'month' ? selectedMonth : thisMonth}
          getAcc={getAcc}
          getCat={getCat}
          onRemove={remove}
        />
      ) : (
        /* ── List view ────────────────────────────────────────────────────── */
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {displayList.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              {search ? `ไม่พบรายการที่ตรงกับ "${search}"` : 'ไม่พบรายการ'}
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {[
                      { label: 'วันที่',      align: 'left',   sortKey: 'date' },
                      { label: 'ชื่อรายการ', align: 'left',   sortKey: 'name' },
                      { label: 'ประเภท',     align: 'left' },
                      { label: 'หมวดหมู่',   align: 'left' },
                      { label: 'บัญชี',      align: 'left' },
                      { label: 'หมายเหตุ',  align: 'left' },
                      { label: 'จำนวน',     align: 'center', sortKey: 'amount' },
                      { label: '',           align: 'left' },
                    ].map((h, i) => (
                      <th key={i} className={`text-${h.align} px-4 py-3 text-xs font-semibold text-slate-500`}>
                        {h.sortKey ? <SortHeader label={h.label} sortKey={h.sortKey} align={h.align} /> : h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedList.map((tx) => {
                  const cat   = getCat(tx.category_id);
                  const acc   = getAcc(tx.account_id);
                  const toAcc = getAcc(tx.to_account_id);
                  return (
                    <tr key={tx.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {formatDisplayDate(tx.transaction_date, '')}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>{tx.name || '—'}</span>
                          {tx.is_recurring && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap flex-shrink-0"
                              style={{ background: '#EAF3F7', color: '#2C6488' }}>
                              ประจำ
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                          style={{ color: TYPE_COLOR[tx.type], background: TYPE_BG[tx.type] }}>
                          {TYPE_LABEL[tx.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {cat ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                              style={{ background: (cat.color || '#2C6488') + '22' }}>
                              <Icon name={cat.icon || 'Tag'} size={11} color={cat.color || '#2C6488'} />
                            </div>
                            <span className="text-xs text-slate-700">{cat.name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {tx.type === 'transfer'
                          ? `${acc?.name || '?'} → ${toAcc?.name || '?'}`
                          : acc?.name || '?'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{tx.note || '—'}</td>
                      <td className="px-4 py-3 text-center font-semibold whitespace-nowrap"
                        style={{ color: TYPE_COLOR[tx.type] }}>
                        {tx.type === 'expense' ? '-' : tx.type === 'adjustment' ? '' : '+'}฿{fmt(tx.amount)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(tx)} disabled={tx.type === 'adjustment'} title={tx.type === 'adjustment' ? 'รายการปรับยอดแก้ไขไม่ได้ หากผิดให้ลบบัญชีแล้วสร้างใหม่' : ''}
                            className={`w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center transition-colors ${tx.type === 'adjustment' ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#DCE8EE]'}`}>
                            <Edit size={11} color="#94a3b8" />
                          </button>
                          <button onClick={() => setDeleteTarget(tx)}
                            className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
                            <Trash2 size={11} color="#94a3b8" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
              {totalRows > TX_PAGE_SIZE && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
                  <p className="text-xs text-slate-500">
                    แสดง {pageStart + 1}-{Math.min(pageStart + displayList.length, totalRows)} จาก {totalRows} รายการ
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage === 1}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                      ก่อนหน้า
                    </button>
                    {pageNumbers.map((page, i) => (
                      <button
                        key={`${page}-${i}`}
                        type="button"
                        onClick={() => setCurrentPage(page)}
                        className={`w-8 h-8 rounded-lg text-xs font-semibold border transition-colors ${
                          safePage === page
                            ? 'bg-[#2C6488] border-[#2C6488] text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-[#EAF3F7]'
                        }`}>
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage === totalPages}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                      ถัดไป
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Modal: เพิ่มรายการ ────────────────────────────────────────────── */}
      {showModal && (
        <Modal
          title={editId ? `แก้ไข${TYPE_LABEL[txType]}` : `เพิ่ม${TYPE_LABEL[txType]}`}
          onClose={() => { setShowModal(false); setEditId(null); }}
        >
          <div className="space-y-4">

            {editId && (txType === 'income' || txType === 'expense') && (
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">ประเภท</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                  {[
                    { value: 'income', label: 'รายรับ', color: '#10b981' },
                    { value: 'expense', label: 'รายจ่าย', color: '#ef4444' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => changeModalType(opt.value)}
                      className="py-2 rounded-lg text-sm font-semibold transition-all"
                      style={txType === opt.value
                        ? { background: '#fff', color: opt.color, boxShadow: '0 1px 2px rgba(15,23,42,0.08)' }
                        : { color: '#64748b' }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 1. วันที่ */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
              <input type="date" value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            {/* 2. ชื่อรายการ */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อรายการ</label>
              <input value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น ค่าข้าวกลางวัน, เติมน้ำมัน"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            {/* 3. จำนวนเงิน */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">จำนวนเงิน (฿)</label>
              <input type="number" value={form.amount} placeholder="0.00" min="0"
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700 text-lg font-bold" />
            </div>

            {/* 4. หมวดหมู่ — แสดงทุก type (รวม transfer ถ้ามี) */}
            {currentCats.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
                <CatSelect
                  value={form.category_id}
                  onChange={(v) => setForm({ ...form, category_id: v })}
                  categories={currentCats}
                  placeholder=""
                />
              </div>
            )}

            {/* 5. บัญชี */}
            {txType !== 'transfer' ? (
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">บัญชี</label>
                <AccSelect
                  value={form.account_id}
                  onChange={(v) => setForm({ ...form, account_id: v })}
                  accounts={transactionAccounts}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">จากบัญชี</label>
                  <AccSelect
                    value={form.from_account_id}
                    onChange={(v) => setForm({ ...form, from_account_id: v })}
                    accounts={transactionAccounts}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ไปยังบัญชี</label>
                  <AccSelect
                    value={form.to_account_id}
                    onChange={(v) => setForm({ ...form, to_account_id: v })}
                    accounts={transactionAccounts}
                  />
                </div>
              </div>
            )}

            {/* 6. หมายเหตุ */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
              <input value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="บันทึกข้อมูลเพิ่มเติม..."
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowModal(false); setEditId(null); }}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60">
                {saving ? 'กำลังบันทึก...' : editId ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: ปรับยอดบัญชี (adjustment) ───────────────────────────────── */}
      {showAdjustModal && adjustAcc && (
        <Modal
          title={`ปรับยอดบัญชี: ${adjustAcc.name}`}
          onClose={() => setShowAdjustModal(false)}
        >
          <div className="space-y-4">

            {/* ยอดปัจจุบัน */}
            <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-slate-500">ยอดปัจจุบัน</span>
              <span className="text-base font-bold text-slate-700">฿{fmt(adjustAcc.balance)}</span>
            </div>

            {/* ยอดใหม่ */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ยอดใหม่ (฿)</label>
              <input
                type="number"
                value={adjustBalance}
                onChange={(e) => setAdjustBalance(e.target.value)}
                placeholder="0.00"
                min="0"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-lg font-bold bg-slate-50 text-slate-700"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowAdjustModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={saveAdjust} disabled={adjustSaving}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60">
                {adjustSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="ลบรายการธุรกรรม"
        message={`ต้องการลบรายการ "${deleteTarget?.name || deleteTarget?.note || 'ไม่มีชื่อรายการ'}" ใช่ไหม?`}
        confirmText="ลบรายการ"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />

    </div>
  );
}

