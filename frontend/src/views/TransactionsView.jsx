import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowLeftRight, Trash2, Edit, Search, X, Download, List, Calendar, ScanLine, Loader2, ChevronDown, DollarSign, Briefcase, Star, Smartphone, TrendingUp, CheckCircle2, XCircle, Clock, Upload, ImageIcon, Wallet, Plus } from 'lucide-react';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { transactions as txApi, slipJobs as slipJobsApi, receiptJobs as receiptJobsApi, scanJobs as scanJobsApi } from '../services/api';
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

const FINAL_OCR_STATUSES = ['saved', 'skipped', 'cancelled'];
const isOcrResultHandled = (result) => FINAL_OCR_STATUSES.includes(result?.status);
const isOcrJobHandled = (job, key) => {
  const results = job?.[key] || [];
  if (job?.status === 'cancelled') return true;
  return results.length > 0 && results.every(isOcrResultHandled);
};
const RECEIPT_BLOCKED_STATUSES = ['rejected', 'error'];
const OCR_ACTIONABLE_STATUSES = ['queued', 'ocr', 'classifying', 'parsing', 'done'];
const receiptBlockedResults = (job) => (job?.receipts || []).filter((r) => RECEIPT_BLOCKED_STATUSES.includes(r.status));
const receiptWasCancelled = (job) => job?.status === 'cancelled' || (job?.receipts || []).some((r) => r.status === 'cancelled');
const hasOnlyBlockedOcrResults = (job, key) => {
  const results = job?.[key] || [];
  return results.some((r) => RECEIPT_BLOCKED_STATUSES.includes(r.status)) &&
    !results.some((r) => OCR_ACTIONABLE_STATUSES.includes(r.status));
};
const receiptBlockedMessage = (job) => {
  const blocked = receiptBlockedResults(job);
  if (blocked.length === 0) return '';
  return blocked[0]?.error_msg || 'รูปนี้ไม่สามารถสแกนเป็นใบเสร็จได้';
};
const receiptResultStatusMeta = (result) => {
  switch (result?.status) {
    case 'done':
      return { label: 'พร้อมตรวจ', tone: 'emerald', icon: 'check' };
    case 'rejected':
      return { label: 'Reject', tone: 'red', icon: 'x' };
    case 'error':
      return { label: 'ผิดพลาด', tone: 'red', icon: 'x' };
    case 'cancelled':
      return { label: 'ยกเลิกแล้ว', tone: 'slate', icon: 'x' };
    case 'skipped':
      return { label: 'ไม่บันทึก', tone: 'amber', icon: 'x' };
    case 'saved':
      return { label: 'บันทึกแล้ว', tone: 'emerald', icon: 'check' };
    case 'ocr':
      return { label: 'กำลังอ่าน', tone: 'brand', icon: 'loader' };
    case 'parsing':
      return { label: 'แปลผล', tone: 'brand', icon: 'loader' };
    default:
      return { label: 'รอคิว', tone: 'slate', icon: 'clock' };
  }
};

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
  const [error,  setError]  = useState('');
  const [editId, setEditId] = useState(null); // null = create, uuid = edit

  // ── OCR ───────────────────────────────────────────────────────────────────
  const ocrFileRef      = useRef(null);
  const [ocrModal,      setOcrModal]     = useState(null);    // null | 'receipt'
  const [ocrStep,       setOcrStep]      = useState('upload'); // 'upload' | 'result'
  const [ocrFiles,      setOcrFiles]     = useState([]);
  const [ocrPreviews,   setOcrPreviews]  = useState([]);
  const [ocrLoading,    setOcrLoading]   = useState(false);
  const [ocrError,      setOcrError]     = useState('');
  const [ocrData,       setOcrData]      = useState(null);
  const [ocrPreview,    setOcrPreview]   = useState('');
  // receipt
  const [ocrItems,      setOcrItems]     = useState([]);  // [{ name, amount, note, category_id, include }]
  const [ocrAccount,    setOcrAccount]   = useState('');
  const [ocrDate,       setOcrDate]      = useState(today);
  const [ocrNote]                       = useState('');
  const [ocrVatAmount,  setOcrVatAmount] = useState('');
  const [ocrVatMode,    setOcrVatMode]   = useState('include'); // include | exclude
  const [ocrDiscountAmount, setOcrDiscountAmount] = useState('');
  const [ocrDiscountMode,   setOcrDiscountMode]   = useState('prorate'); // prorate | ignore
  const [ocrSaving,     setOcrSaving]    = useState(false);
  const [ocrZoomImg,    setOcrZoomImg]   = useState(null);  // URL | null
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── Receipt async job ─────────────────────────────────────────────────────
  const receiptPollRef = useRef(null);
  const [receiptJob, setReceiptJob] = useState(null);
  const [activeReceiptId, setActiveReceiptId] = useState(null);
  const activeReceiptIdRef = useRef(null);
  const [receiptJobsList, setReceiptJobsList] = useState([]);
  const [slipJobsList, setSlipJobsList] = useState([]);
  const [scanJobsList, setScanJobsList] = useState([]);
  const [ocrSource, setOcrSource] = useState('receipt'); // receipt | scan
  const [ocrCancelling, setOcrCancelling] = useState({});
  const [ocrSkipping, setOcrSkipping] = useState({});
  const ocrJobsPollRef = useRef(null);

  const setActiveReceipt = (id) => {
    activeReceiptIdRef.current = id;
    setActiveReceiptId(id);
  };

  const ocrStatusText = (job, key) => {
    const results = job?.[key] || [];
    if (job?.status === 'cancelled') return 'ยกเลิกแล้ว';
    if (results.some((r) => r.status === 'rejected')) return key === 'receipts' ? 'ไม่ใช่ใบเสร็จ' : 'ไม่ใช่สลิป';
    if (results.some((r) => r.status === 'error')) return key === 'receipts' ? 'อ่านใบเสร็จไม่สำเร็จ' : 'อ่านสลิปไม่สำเร็จ';
    if (results.some((r) => r.status === 'done')) return key === 'receipts' ? 'อ่านเสร็จแล้ว รอตรวจ' : 'สแกนเสร็จแล้ว รอตรวจ';
    if (job?.status === 'done') return key === 'receipts' ? 'อ่านเสร็จแล้ว' : 'สแกนเสร็จแล้ว';
    return key === 'receipts' ? 'กำลังอ่านใบเสร็จ' : 'กำลังสแกนสลิป';
  };
  const ocrStatusColor = (job, key) => {
    const results = job?.[key] || [];
    if (job?.status === 'cancelled') return 'text-slate-500';
    if (results.some((r) => r.status === 'rejected' || r.status === 'error')) return 'text-red-500';
    if (results.some((r) => r.status === 'done') || job?.status === 'done') return 'text-emerald-600';
    return 'text-[#2C6488]';
  };

  const scanToReceiptJob = (job) => ({
    ...job,
    receipts: (job?.results || [])
      .filter((r) => r.document_type !== 'slip')
      .map((r) => ({
        id: r.id,
        job_id: r.job_id,
        status: r.status,
        image_path: r.image_path,
        filename: r.filename,
        data: r.data,
        error_msg: r.error_msg,
        created_at: r.created_at,
      })),
  });

  const scanToSlipJob = (job) => ({
    ...job,
    slips: (job?.results || [])
      .filter((r) => r.document_type === 'slip')
      .map((r) => ({
        id: r.id,
        job_id: r.job_id,
        status: r.status,
        filename: r.filename,
        image_path: r.image_path,
        bank: r.slip?.bank || null,
        amount: r.slip?.amount || 0,
        transaction_date: r.slip?.date || null,
        transaction_time: r.slip?.time || null,
        sender: r.slip?.sender || null,
        receiver: r.slip?.receiver || null,
        ref_no: r.slip?.ref_no || null,
        is_duplicate: !!r.is_duplicate,
        error_msg: r.error_msg,
        created_at: r.created_at,
      })),
  });

  const isScanJobHandled = (job) => {
    const results = job?.results || [];
    if (job?.status === 'cancelled') return true;
    return results.length > 0 && results.every(isOcrResultHandled);
  };

  const scanStatusText = (job) => {
    const results = job?.results || [];
    if (job?.status === 'cancelled') return 'ยกเลิกแล้ว';
    if (results.some((r) => r.status === 'done')) return 'สแกนเสร็จแล้ว รอตรวจ';
    if (results.some((r) => r.status === 'rejected' || r.status === 'error')) return 'มีรูปที่สแกนไม่สำเร็จ';
    if (job?.status === 'done') return 'สแกนเสร็จแล้ว';
    return 'กำลังสแกนเอกสาร';
  };

  const scanStatusColor = (job) => {
    const results = job?.results || [];
    if (job?.status === 'cancelled') return 'text-slate-500';
    if (results.some((r) => r.status === 'rejected' || r.status === 'error')) return 'text-red-500';
    if (results.some((r) => r.status === 'done') || job?.status === 'done') return 'text-emerald-600';
    return 'text-[#2C6488]';
  };

  const clearBlockedReceiptResults = async (job = receiptJob) => {
    if (!job?.id || !hasOnlyBlockedOcrResults(job, 'receipts')) return;
    const skipApi = ocrSource === 'scan' ? scanJobsApi.skip : receiptJobsApi.skip;
    await Promise.all((job.receipts || [])
      .filter((result) => RECEIPT_BLOCKED_STATUSES.includes(result.status))
      .map((result) => skipApi(job.id, result.id).catch(() => null)));
    await refreshOcrJobs();
  };

  const closeOcr = async () => {
    if (receiptPollRef.current) clearInterval(receiptPollRef.current);
    await clearBlockedReceiptResults();
    setOcrModal(null); setOcrStep('upload');
    setOcrFiles([]); setOcrPreviews([]);
    setReceiptJob(null); setActiveReceipt(null);
    setOcrData(null); setOcrPreview(''); setOcrError('');
    setOcrItems([]); setOcrLoading(false); setOcrZoomImg(null);
    setOcrVatAmount(''); setOcrVatMode('include'); setOcrDiscountAmount(''); setOcrDiscountMode('prorate');
  };

  const handleOcrFileSelect = (fileList) => {
    const fileArr = Array.isArray(fileList) ? fileList : Array.from(fileList?.length ? fileList : [fileList]).filter(Boolean);
    if (fileArr.length === 0) return;
    const slots = Math.max(0, 5 - ocrFiles.length);
    if (slots === 0) {
      setOcrError('เพิ่มรูปได้สูงสุด 5 รูปต่อครั้ง');
      return;
    }
    const selected = fileArr.slice(0, slots);
    setOcrFiles((prev) => [...prev, ...selected]);
    setOcrError(fileArr.length > slots ? 'เพิ่มได้สูงสุด 5 รูปต่อครั้ง ระบบเพิ่มให้เท่าที่เหลือแล้ว' : '');
    const previews = new Array(selected.length).fill('');
    let loaded = 0;
    selected.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        previews[i] = e.target.result;
        loaded++;
        if (loaded === selected.length) {
          setOcrPreviews((prev) => {
            const next = [...prev, ...previews];
            setOcrPreview(next[0] || '');
            return next;
          });
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeOcrFile = (index) => {
    setOcrFiles((prev) => prev.filter((_, i) => i !== index));
    setOcrPreviews((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setOcrPreview(next[0] || '');
      return next;
    });
    setOcrError('');
  };

  const receiptBaseItems = (items = ocrItems) =>
    items
      .filter((it) => it.include && Number(it.amount) > 0)
      .map((it) => ({ ...it, baseAmount: Number(it.amount) || 0 }));

  const receiptAdjustmentAmounts = () => ({
    vat: ocrVatMode === 'exclude' ? Math.max(0, Number(ocrVatAmount) || 0) : 0,
    discount: ocrDiscountMode === 'prorate' ? Math.max(0, Number(ocrDiscountAmount) || 0) : 0,
  });

  const receiptFinalItems = (items = ocrItems) => {
    const selected = receiptBaseItems(items);
    const baseTotal = selected.reduce((sum, it) => sum + it.baseAmount, 0);
    const { vat, discount } = receiptAdjustmentAmounts();
    if (baseTotal <= 0) return selected.map((it) => ({ ...it, finalAmount: 0 }));
    return selected.map((it) => {
      const ratio = it.baseAmount / baseTotal;
      const finalAmount = Math.max(0, it.baseAmount + (vat * ratio) - (discount * ratio));
      return { ...it, finalAmount: Number(finalAmount.toFixed(2)) };
    });
  };

  const receiptTotals = () => {
    const selected = receiptBaseItems();
    const baseTotal = selected.reduce((sum, it) => sum + it.baseAmount, 0);
    const { vat, discount } = receiptAdjustmentAmounts();
    const finalTotal = Math.max(0, baseTotal + vat - discount);
    return { baseTotal, vat, discount, finalTotal };
  };

  const receiptItemAdjustmentPreview = (item) => {
    const baseAmount = Number(item?.amount) || 0;
    if (!item?.include || baseAmount <= 0) {
      return { vat: 0, discount: 0, finalAmount: baseAmount };
    }
    const selected = receiptBaseItems();
    const baseTotal = selected.reduce((sum, it) => sum + it.baseAmount, 0);
    if (baseTotal <= 0) {
      return { vat: 0, discount: 0, finalAmount: baseAmount };
    }
    const { vat, discount } = receiptAdjustmentAmounts();
    const ratio = baseAmount / baseTotal;
    const itemVAT = vat * ratio;
    const itemDiscount = discount * ratio;
    const finalAmount = Math.max(0, baseAmount + itemVAT - itemDiscount);
    return {
      vat: Number(itemVAT.toFixed(2)),
      discount: Number(itemDiscount.toFixed(2)),
      finalAmount: Number(finalAmount.toFixed(2)),
    };
  };

  const applyReceiptResult = (result, preview = '') => {
    if (!result?.data) return;
    const d = result.data || {};
    setActiveReceipt(result.id);
    setOcrData(d);
    setOcrPreview(preview || (result.image_path ? `http://localhost:8080${result.image_path}` : ''));
    setOcrDate(d.date || today);
    setOcrAccount(defaultAccountId);
    setOcrVatAmount(d.vat?.amount > 0 ? String(d.vat.amount) : '');
    setOcrVatMode(d.vat?.mode === 'exclude' ? 'exclude' : 'include');
    setOcrDiscountAmount(d.discount?.amount > 0 ? String(d.discount.amount) : '');
    setOcrDiscountMode(d.discount?.mode === 'ignore' ? 'ignore' : 'prorate');
    setOcrItems((d.items || [])
      .filter((it) => (it.amount || it.unit_price || 0) > 0)
      .map((it) => ({
        name:        it.name || '',
        amount:      it.amount || ((Number(it.unit_price) || 0) * (Number(it.quantity) || 1)),
        note:        it.note || '',
        category_id: expCats[0]?.id || '',
        include:     true,
      })));
    setOcrStep('result');
  };

  const waitForNextReceiptResult = (job) => {
    setReceiptJob(job);
    setActiveReceipt(null);
    setOcrData(null);
    setOcrPreview('');
    setOcrItems([]);
    setOcrError('');
    setOcrStep('processing');
  };

  const openReadyReceiptIfIdle = (job, previews = ocrPreviews) => {
    if (activeReceiptIdRef.current) return false;
    const doneResult = (job?.receipts || []).find((r) => r.status === 'done');
    if (!doneResult) return false;
    const idx = (job.receipts || []).findIndex((r) => r.id === doneResult.id);
    applyReceiptResult(doneResult, previews[idx] || '');
    return true;
  };

  const showReceiptJobOutcome = (job, previews = ocrPreviews) => {
    setReceiptJob(job);
    const doneResult = (job.receipts || []).find((r) => r.status === 'done');
    if (doneResult) {
      const idx = (job.receipts || []).findIndex((r) => r.id === doneResult.id);
      applyReceiptResult(doneResult, previews[idx] || '');
      return;
    }

    const message = receiptBlockedMessage(job);
    if (message) {
      setOcrError(message);
      setOcrStep('processing');
      return;
    }

    if (job.status === 'done') {
      setOcrError('อ่านใบเสร็จเสร็จแล้ว แต่ไม่พบรายการที่พร้อมบันทึก');
      setOcrStep('processing');
    }
  };

  const runOcr = async () => {
    if (ocrFiles.length === 0) return;
    setOcrLoading(true); setOcrError('');
    try {
      if (ocrModal === 'receipt') {
        // ── Async receipt job ──────────────────────────────────────────────
        const res = ocrSource === 'scan'
          ? await scanJobsApi.create(ocrFiles)
          : await receiptJobsApi.create(ocrFiles);
        const jobId = res.job_id;
        setOcrStep('processing'); // ขั้นตอนกลาง: แสดง spinner ขณะรอ

        const poll = async () => {
          try {
            const rawJob = ocrSource === 'scan' ? await scanJobsApi.get(jobId) : await receiptJobsApi.get(jobId);
            const job = ocrSource === 'scan' ? scanToReceiptJob(rawJob) : rawJob;
            setReceiptJob(job);
            if (ocrSource === 'scan') {
              const slipJobFromScan = scanToSlipJob(rawJob);
              if (slipJobFromScan.slips.some((s) => s.status === 'done') && !(job.receipts || []).some((r) => r.status === 'done')) {
                clearInterval(receiptPollRef.current);
                setOcrModal(null);
                openScanJob(jobId);
                return;
              }
            }
            openReadyReceiptIfIdle(job);
            if (job.status === 'done') {
              clearInterval(receiptPollRef.current);
              if (!activeReceiptIdRef.current) {
                showReceiptJobOutcome(job);
              }
            } else if (job.status === 'error') {
              clearInterval(receiptPollRef.current);
              setOcrError(job.error_msg || 'อ่านใบเสร็จไม่สำเร็จ');
              setOcrStep('upload');
            }
          } catch { /* keep polling */ }
        };

        await poll();
        receiptPollRef.current = setInterval(poll, 2000);
        refreshOcrJobs();
      }
    } catch (err) {
      setOcrError(err.message || 'อ่านใบเสร็จไม่สำเร็จ');
      setOcrStep('upload');
    } finally {
      setOcrLoading(false);
    }
  };

  const openReceiptJob = async (jobId) => {
    if (!hasAccounts) return;
    setOcrSource('receipt');
    setOcrModal('receipt');
    setOcrStep('processing');
    setOcrError('');
    setActiveReceipt(null);
    try {
      const job = await receiptJobsApi.get(jobId);
      showReceiptJobOutcome(job);
    } catch (err) {
      setOcrError(err.message || 'โหลดรายการที่สแกนไม่สำเร็จ');
    }
  };

  const openScanJob = async (jobId) => {
    if (!hasAccounts) return;
    setOcrSource('scan');
    setOcrError('');
    setSlipError('');
    try {
      const rawJob = await scanJobsApi.get(jobId);
      const receiptJobFromScan = scanToReceiptJob(rawJob);
      const slipJobFromScan = scanToSlipJob(rawJob);
      const hasReceiptReady = (receiptJobFromScan.receipts || []).some((r) => r.status === 'done');
      const hasReceiptWorking = (receiptJobFromScan.receipts || []).some((r) => ['queued', 'ocr', 'classifying', 'parsing'].includes(r.status));
      const hasSlipAny = (slipJobFromScan.slips || []).length > 0;

      if (hasReceiptReady || hasReceiptWorking || !hasSlipAny) {
        setOcrModal('receipt');
        setOcrStep(hasReceiptReady ? 'result' : 'processing');
        setReceiptJob(receiptJobFromScan);
        setActiveReceipt(null);
        showReceiptJobOutcome(receiptJobFromScan);
        return;
      }

      setSlipSource('scan');
      setShowSlipScanner(true);
      setSlipJobId(rawJob.id);
      setSlipJob(slipJobFromScan);
      setSlipFiles([]);
      setSlipPreviews([]);
      setSlipReview((prev) => {
        const next = { ...prev };
        (slipJobFromScan.slips || []).forEach((r) => {
          if (r.status === 'done' && !next[r.id]) {
            const expCat = expCats[0];
            next[r.id] = {
              tx_type: 'expense',
              account_id: defaultAccountId,
              category_id: expCat?.id || '',
              name: r.receiver || r.sender || '',
              note: '',
              amount: Number(r.amount || 0).toFixed(2),
              transaction_date: r.transaction_date || today,
            };
          }
        });
        return next;
      });
    } catch (err) {
      setOcrModal('receipt');
      setOcrStep('processing');
      setOcrError(err.message || 'โหลดรายการที่สแกนไม่สำเร็จ');
    }
  };

  const cancelReceiptJob = async (jobId) => {
    const cancelKey = ocrSource === 'scan' ? `scan-${jobId}` : `receipt-${jobId}`;
    setOcrCancelling((p) => ({ ...p, [cancelKey]: true }));
    try {
      await (ocrSource === 'scan' ? scanJobsApi.cancel(jobId) : receiptJobsApi.cancel(jobId));
      if (receiptPollRef.current) clearInterval(receiptPollRef.current);
      if (receiptJob?.id === jobId) {
        const rawJob = await (ocrSource === 'scan' ? scanJobsApi.get(jobId) : receiptJobsApi.get(jobId)).catch(() => null);
        if (rawJob) setReceiptJob(ocrSource === 'scan' ? scanToReceiptJob(rawJob) : rawJob);
        setOcrStep('processing');
      }
      await refreshOcrJobs();
    } catch (err) {
      setOcrError(err.message || 'ยกเลิกสแกนไม่สำเร็จ');
    } finally {
      setOcrCancelling((p) => ({ ...p, [cancelKey]: false }));
    }
  };

  const saveOcrReceipt = async () => {
    const selected = receiptFinalItems();
    if (selected.length === 0) { setOcrError('เลือกรายการอย่างน้อย 1 อัน'); return; }
    if (selected.some((it) => !it.category_id)) { setOcrError('กรุณาเลือกหมวดหมู่ให้ครบทุกรายการ'); return; }
    const total = selected.reduce((sum, it) => sum + Number(it.finalAmount || 0), 0);
    if (total <= 0) { setOcrError('ยอดสุทธิต้องมากกว่า 0 บาท'); return; }
    const account = transactionAccounts.find((a) => a.id === ocrAccount);
    if (!account) { setOcrError('กรุณาเลือกบัญชีที่ใช้บันทึกรายจ่าย'); return; }
    if (total > Number(account?.balance || 0)) {
      setOcrError(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(account?.balance || 0)}`);
      return;
    }
    setOcrSaving(true); setOcrError('');
    try {
      await Promise.all(selected.map((it) =>
        txApi.create({
          type:             'expense',
          amount:           Number(it.finalAmount || 0),
          name:             it.name || null,
          note:             it.note || ocrNote || null,
          category_id:      it.category_id,
          account_id:       ocrAccount,
          transaction_date: ocrDate,
        })
      ));
      if (receiptJob?.id && activeReceiptId) {
        await (ocrSource === 'scan' ? scanJobsApi.save(receiptJob.id, activeReceiptId) : receiptJobsApi.save(receiptJob.id, activeReceiptId));
      }
      await Promise.all([fetchTx(), onRefreshAccounts?.(), onNotificationRefresh?.()]);
      if (receiptJob?.id) {
        const rawUpdatedJob = await (ocrSource === 'scan' ? scanJobsApi.get(receiptJob.id) : receiptJobsApi.get(receiptJob.id));
        const updatedJob = ocrSource === 'scan' ? scanToReceiptJob(rawUpdatedJob) : rawUpdatedJob;
        setReceiptJob(updatedJob);
        const nextResult = (updatedJob.receipts || []).find((r) => r.status === 'done');
        if (nextResult) {
          applyReceiptResult(nextResult);
        } else if (ocrSource === 'scan' && scanToSlipJob(rawUpdatedJob).slips.some((s) => s.status === 'done')) {
          closeOcr();
          openScanJob(rawUpdatedJob.id);
        } else if (isOcrJobHandled(updatedJob, 'receipts')) {
          closeOcr();
        } else if (receiptBlockedResults(updatedJob).length > 0 || updatedJob.status === 'done') {
          showReceiptJobOutcome(updatedJob);
        } else {
          waitForNextReceiptResult(updatedJob);
        }
      } else {
        closeOcr();
      }
      await refreshOcrJobs();
    } catch (err) {
      setOcrError(err.message);
    } finally {
      setOcrSaving(false);
    }
  };

  const skipOcrReceipt = async () => {
    if (!receiptJob?.id || !activeReceiptId) return;
    setOcrSkipping((p) => ({ ...p, [`receipt-${activeReceiptId}`]: true }));
    setOcrError('');
    try {
      await (ocrSource === 'scan' ? scanJobsApi.skip(receiptJob.id, activeReceiptId) : receiptJobsApi.skip(receiptJob.id, activeReceiptId));
      const rawUpdatedJob = await (ocrSource === 'scan' ? scanJobsApi.get(receiptJob.id) : receiptJobsApi.get(receiptJob.id));
      const updatedJob = ocrSource === 'scan' ? scanToReceiptJob(rawUpdatedJob) : rawUpdatedJob;
      setReceiptJob(updatedJob);
      const nextResult = (updatedJob.receipts || []).find((r) => r.status === 'done');
      if (nextResult) {
        applyReceiptResult(nextResult);
      } else if (ocrSource === 'scan' && scanToSlipJob(rawUpdatedJob).slips.some((s) => s.status === 'done')) {
        closeOcr();
        openScanJob(rawUpdatedJob.id);
      } else if (isOcrJobHandled(updatedJob, 'receipts')) {
        closeOcr();
      } else if (receiptBlockedResults(updatedJob).length > 0 || updatedJob.status === 'done') {
        showReceiptJobOutcome(updatedJob);
      } else {
        waitForNextReceiptResult(updatedJob);
      }
      await refreshOcrJobs();
    } catch (err) {
      setOcrError(err.message || 'ข้ามรายการไม่สำเร็จ');
    } finally {
      setOcrSkipping((p) => ({ ...p, [`receipt-${activeReceiptId}`]: false }));
    }
  };

  // ── Batch Slip Scanner ────────────────────────────────────────────────────
  const slipFileRef       = useRef(null);
  const slipPollRef       = useRef(null);
  const [showSlipScanner, setShowSlipScanner] = useState(false);
  const [slipFiles,       setSlipFiles]       = useState([]);
  const [slipPreviews,    setSlipPreviews]    = useState([]);
  const [slipJobId,       setSlipJobId]       = useState(null);
  const [slipJob,         setSlipJob]         = useState(null);
  const [slipUploading,   setSlipUploading]   = useState(false);
  const [slipError,       setSlipError]       = useState('');
  const [slipSaving,      setSlipSaving]      = useState({});
  const [slipSaved,       setSlipSaved]       = useState({});
  const [slipReview,      setSlipReview]      = useState({});
  const [slipZoomImg,     setSlipZoomImg]     = useState(null); // URL | null
  const [slipSource,      setSlipSource]      = useState('slip'); // slip | scan

  const openSlipJob = async (jobId) => {
    if (!hasAccounts) return;
    setSlipSource('slip');
    setShowSlipScanner(true);
    setSlipJobId(jobId);
    setSlipFiles([]); setSlipPreviews([]); setSlipError('');
    try {
      const job = await slipJobsApi.get(jobId);
      setSlipJob(job);
      setSlipReview((prev) => {
        const next = { ...prev };
        (job.slips || []).forEach((r) => {
          if (r.status === 'done' && !next[r.id]) {
              const expCat = expCats[0];
            next[r.id] = {
              tx_type: 'expense',
              account_id: defaultAccountId,
              category_id: expCat?.id || '',
              name: r.receiver || r.sender || '',
              note: '',
              amount: Number(r.amount || 0).toFixed(2),
              transaction_date: r.transaction_date || today,
            };
          }
        });
        return next;
      });
    } catch (err) {
      setSlipError(err.message || 'โหลดรายการที่สแกนไม่สำเร็จ');
    }
  };

  const clearBlockedSlipResults = async (job = slipJob) => {
    const jobId = job?.id || slipJobId;
    if (!jobId || !hasOnlyBlockedOcrResults(job, 'slips')) return;
    const skipApi = slipSource === 'scan' ? scanJobsApi.skip : slipJobsApi.skip;
    await Promise.all((job.slips || [])
      .filter((result) => RECEIPT_BLOCKED_STATUSES.includes(result.status))
      .map((result) => skipApi(jobId, result.id).catch(() => null)));
    await refreshOcrJobs();
  };

  const closeSlipScanner = async () => {
    if (slipPollRef.current) clearInterval(slipPollRef.current);
    await clearBlockedSlipResults();
    setShowSlipScanner(false);
  };

  const handleSlipFilesSelect = (fileList) => {
    const fileArr = Array.from(fileList || []).filter(Boolean);
    if (fileArr.length === 0) return;
    const slots = Math.max(0, 5 - slipFiles.length);
    if (slots === 0) {
      setSlipError('เพิ่มรูปได้สูงสุด 5 รูปต่อครั้ง');
      return;
    }
    const selected = fileArr.slice(0, slots);
    setSlipFiles((prev) => [...prev, ...selected]);
    setSlipError(fileArr.length > slots ? 'เพิ่มได้สูงสุด 5 รูปต่อครั้ง ระบบเพิ่มให้เท่าที่เหลือแล้ว' : '');
    const previews = new Array(selected.length).fill('');
    let loaded = 0;
    selected.forEach((f, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        previews[i] = e.target.result;
        loaded++;
        if (loaded === selected.length) {
          setSlipPreviews((prev) => [...prev, ...previews]);
        }
      };
      reader.readAsDataURL(f);
    });
  };

  const removeSlipFile = (idx) => {
    setSlipFiles((p) => p.filter((_, i) => i !== idx));
    setSlipPreviews((p) => p.filter((_, i) => i !== idx));
  };

  const startSlipJob = async () => {
    if (slipFiles.length === 0) return;
    setSlipUploading(true); setSlipError('');
    try {
      const res = await slipJobsApi.create(slipFiles);
      const jobId = res.job_id;
      setSlipJobId(jobId);
      refreshOcrJobs();

      const poll = async () => {
        try {
          const job = await slipJobsApi.get(jobId);
          setSlipJob(job);
          setSlipReview((prev) => {
            const next = { ...prev };
            (job.slips || []).forEach((r) => {
              if (r.status === 'done' && !next[r.id]) {
                const expCat = expCats[0];
                const autoName = r.receiver
                  ? `${r.receiver}`
                  : r.sender
                    ? `${r.sender}`
                    : '';
                next[r.id] = {
                  tx_type:          'expense',
                  account_id:       defaultAccountId,
                  category_id:      expCat?.id || '',
                  name:             autoName,
                  note:             '',
                  amount:           Number(r.amount || 0).toFixed(2),
                  transaction_date: r.transaction_date || today,
                };
              }
            });
            return next;
          });
          if (job.status === 'done' || job.status === 'error') {
            clearInterval(slipPollRef.current);
          }
        } catch { /* keep polling on transient errors */ }
      };

      await poll();
      slipPollRef.current = setInterval(poll, 2000);
    } catch (err) {
      setSlipError(err.message || 'เกิดข้อผิดพลาดในการอัปโหลด');
    } finally {
      setSlipUploading(false);
    }
  };

  const saveSlipResult = async (slip) => {
    const rv = slipReview[slip.id];
    if (!rv) return;
    if (!rv.amount || parseFloat(rv.amount) <= 0) { setSlipError('กรุณาใส่จำนวนเงิน'); return; }
    if (!rv.account_id) { setSlipError('กรุณาเลือกบัญชี'); return; }
    if (!transactionAccountIds.has(rv.account_id)) { setSlipError('กรุณาเลือกบัญชีที่ใช้บันทึกรายการได้'); return; }
    if (!rv.category_id) { setSlipError('กรุณาเลือกหมวดหมู่'); return; }
    if ((rv.tx_type || 'expense') === 'expense') {
      const account = transactionAccounts.find((a) => a.id === rv.account_id);
      if (parseFloat(rv.amount) > Number(account?.balance || 0)) {
        setSlipError(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(account?.balance || 0)}`);
        return;
      }
    }
    setSlipSaving((p) => ({ ...p, [slip.id]: true }));
    setSlipError('');
    try {
      const saveApi = slipSource === 'scan' ? scanJobsApi.saveSlip : slipJobsApi.save;
      await saveApi(slipJobId, slip.id, {
        tx_type:          rv.tx_type || 'expense',
        account_id:       rv.account_id,
        category_id:      rv.category_id,
        amount:           Number(parseFloat(rv.amount).toFixed(2)),
        name:             rv.name || '',
        transaction_date: rv.transaction_date || today,
        note:             rv.note || '',
        ref_no:           slip.ref_no || '',
        image_path:       slip.image_path || '',
      });
      setSlipSaved((p) => ({ ...p, [slip.id]: true }));
      await Promise.all([onRefreshAccounts?.(), fetchTx(), onNotificationRefresh?.()]);
      const rawJob = await (slipSource === 'scan' ? scanJobsApi.get(slipJobId) : slipJobsApi.get(slipJobId));
      const job = slipSource === 'scan' ? scanToSlipJob(rawJob) : rawJob;
      setSlipJob(job);
      if (slipSource === 'scan' ? isScanJobHandled(rawJob) : isOcrJobHandled(job, 'slips')) {
        closeSlipScanner();
      }
      await refreshOcrJobs();
    } catch (err) {
      setSlipError(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSlipSaving((p) => ({ ...p, [slip.id]: false }));
    }
  };

  const skipSlipResult = async (slip) => {
    if (!slipJobId || !slip?.id) return;
    setOcrSkipping((p) => ({ ...p, [`slip-${slip.id}`]: true }));
    setSlipError('');
    try {
      await (slipSource === 'scan' ? scanJobsApi.skip(slipJobId, slip.id) : slipJobsApi.skip(slipJobId, slip.id));
      const rawJob = await (slipSource === 'scan' ? scanJobsApi.get(slipJobId) : slipJobsApi.get(slipJobId));
      const job = slipSource === 'scan' ? scanToSlipJob(rawJob) : rawJob;
      setSlipJob(job);
      if (slipSource === 'scan' ? isScanJobHandled(rawJob) : isOcrJobHandled(job, 'slips')) {
        closeSlipScanner();
      }
      await refreshOcrJobs();
    } catch (err) {
      setSlipError(err.message || 'ข้ามรายการไม่สำเร็จ');
    } finally {
      setOcrSkipping((p) => ({ ...p, [`slip-${slip.id}`]: false }));
    }
  };

  const cancelSlipJob = async (jobId) => {
    const cancelKey = slipSource === 'scan' ? `scan-${jobId}` : `slip-${jobId}`;
    setOcrCancelling((p) => ({ ...p, [cancelKey]: true }));
    try {
      await (slipSource === 'scan' ? scanJobsApi.cancel(jobId) : slipJobsApi.cancel(jobId));
      if (slipPollRef.current) clearInterval(slipPollRef.current);
      if (slipJobId === jobId) {
        const rawJob = await (slipSource === 'scan' ? scanJobsApi.get(jobId) : slipJobsApi.get(jobId)).catch(() => null);
        if (rawJob) setSlipJob(slipSource === 'scan' ? scanToSlipJob(rawJob) : rawJob);
      }
      await refreshOcrJobs();
    } catch (err) {
      setSlipError(err.message || 'ยกเลิกสแกนไม่สำเร็จ');
    } finally {
      setOcrCancelling((p) => ({ ...p, [cancelKey]: false }));
    }
  };

  const refreshOcrJobs = useCallback(async () => {
    try {
      const [scanList, receiptList, slipList] = await Promise.all([
        scanJobsApi.list(),
        receiptJobsApi.list(),
        slipJobsApi.list(),
      ]);
      const [scanDetails, receiptDetails, slipDetails] = await Promise.all([
        Promise.all((scanList || []).map((job) => scanJobsApi.get(job.id).catch(() => job))),
        Promise.all((receiptList || []).map((job) => receiptJobsApi.get(job.id).catch(() => job))),
        Promise.all((slipList || []).map((job) => slipJobsApi.get(job.id).catch(() => job))),
      ]);
      setScanJobsList(scanDetails.filter((job) => !isScanJobHandled(job)));
      setReceiptJobsList(receiptDetails.filter((job) => !isOcrJobHandled(job, 'receipts')));
      setSlipJobsList(slipDetails.filter((job) => !isOcrJobHandled(job, 'slips')));
    } catch {
      // ignore transient polling errors
    }
  }, []);

  useEffect(() => {
    refreshOcrJobs();
    ocrJobsPollRef.current = setInterval(refreshOcrJobs, 5000);
    return () => {
      if (ocrJobsPollRef.current) clearInterval(ocrJobsPollRef.current);
    };
  }, [refreshOcrJobs]);

  // cleanup polling on unmount
  useEffect(() => () => {
    if (slipPollRef.current) clearInterval(slipPollRef.current);
    if (receiptPollRef.current) clearInterval(receiptPollRef.current);
  }, []);

  // ── Fetch (no pagination: limit=1000) ────────────────────────────────────
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAcc] = useState(null);
  const [adjustBalance, setAdjustBalance] = useState('');
  const [adjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  const saveAdjust = () => {
    setAdjustError('รายการปรับยอดแก้ไขไม่ได้ หากยอดผิดให้ลบบัญชีแล้วสร้างใหม่');
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
    setError('');
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getAcc = (id) => accounts.find((a) => a.id === id);
  const getCat = (id) => (categories || []).find((c) => c.id === id);

  // ── Add transaction ───────────────────────────────────────────────────────
  const openAdd = (type) => {
    if (!hasAccounts) return;
    setTxType(type);
    setEditId(null);
    setError('');
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
    setError('');
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
    if (!form.amount || amount <= 0) { setError('กรุณาใส่จำนวนเงิน'); return; }
    if (!form.category_id) { setError('กรุณาเลือกหมวดหมู่'); return; }
    if (txType === 'transfer') {
      if (!transactionAccountIds.has(form.from_account_id) || !transactionAccountIds.has(form.to_account_id)) {
        setError('กรุณาเลือกบัญชีที่ใช้บันทึกรายการได้');
        return;
      }
    } else if (!transactionAccountIds.has(form.account_id)) {
      setError('กรุณาเลือกบัญชีที่ใช้บันทึกรายการได้');
      return;
    }
    if (txType === 'transfer' && form.from_account_id === form.to_account_id) {
      setError('บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน');
      return;
    }
    const oldTx = editId ? txList.find((tx) => tx.id === editId) : null;
    const outflowAccountId = txType === 'transfer' ? form.from_account_id : txType === 'expense' ? form.account_id : null;
    if (outflowAccountId) {
      const available = getAvailableForOutflow(outflowAccountId, oldTx);
      if (amount > available) {
        setError(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(available)}`);
        return;
      }
    }
    setSaving(true);
    setError('');
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
      setError(err.message);
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

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      {hasAccounts && [...scanJobsList, ...receiptJobsList, ...slipJobsList].length > 0 && (
        <div className="rounded-xl border border-[#DCE8EE] bg-white px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-[#2C6488]" />
              <p className="text-xs font-semibold text-slate-700">รายการที่สแกน</p>
            </div>
            <button onClick={refreshOcrJobs} className="text-[11px] font-medium text-[#2C6488] hover:underline">รีเฟรช</button>
          </div>
          <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
            {scanJobsList.slice(0, 3).map((job) => (
              <button key={`scan-${job.id}`} onClick={() => openScanJob(job.id)}
                className="text-left rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 hover:bg-[#EAF3F7] transition-colors w-full">
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="font-semibold text-slate-700">เอกสาร {job.done_count}/{job.total_count}</span>
                  <span className={`${scanStatusColor(job)} whitespace-nowrap`}>{scanStatusText(job)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#2C6488]" style={{ width: `${job.total_count ? (job.done_count / job.total_count) * 100 : 0}%` }} />
                </div>
              </button>
            ))}
            {receiptJobsList.slice(0, 3).map((job) => (
              <button key={`receipt-${job.id}`} onClick={() => openReceiptJob(job.id)}
                className="text-left rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 hover:bg-[#EAF3F7] transition-colors w-full">
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="font-semibold text-slate-700">ใบเสร็จ {job.done_count}/{job.total_count}</span>
                  <span className={`${ocrStatusColor(job, 'receipts')} whitespace-nowrap`}>{ocrStatusText(job, 'receipts')}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#2C6488]" style={{ width: `${job.total_count ? (job.done_count / job.total_count) * 100 : 0}%` }} />
                </div>
              </button>
            ))}
            {slipJobsList.slice(0, 3).map((job) => (
              <button key={`slip-${job.id}`} onClick={() => openSlipJob(job.id)}
                className="text-left rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 hover:bg-[#EAF3F7] transition-colors w-full">
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="font-semibold text-slate-700">สลิป {job.done_count}/{job.total_count}</span>
                  <span className={`${ocrStatusColor(job, 'slips')} whitespace-nowrap`}>{ocrStatusText(job, 'slips')}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#2C6488]" style={{ width: `${job.total_count ? (job.done_count / job.total_count) * 100 : 0}%` }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap items-center">
        <select value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700">
          <option value="today">วันนี้</option>
          <option value="week">สัปดาห์นี้</option>
          <option value="month">เดือนนี้</option>
          <option value="year">ปีนี้</option>
          <option value="all">รายการทั้งหมด</option>
        </select>
        {filterMonth === 'month' && (
          <input type="month" value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700" />
        )}
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700">
          <option value="all">ทุกประเภท</option>
          <option value="income">รายรับ</option>
          <option value="expense">รายจ่าย</option>
          <option value="transfer">โอนเงิน</option>
          <option value="adjustment">ปรับยอด</option>
        </select>
        <select value={filterAcc} onChange={(e) => setFilterAcc(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white text-slate-700">
          <option value="all">ทุกบัญชี</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

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
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

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
            {adjustError && (
              <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{adjustError}</p>
            )}

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

      {/* ── Modal: Unified document scan ─────────────────────────────────────── */}
      {ocrModal === 'receipt' && (
        <Modal title="สแกนเอกสาร" onClose={closeOcr} size="lg">
          <div className="space-y-4">
            {ocrError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{ocrError}</p>}

            {/* ─── Step: processing (async job กำลังทำงาน) ─── */}
            {ocrStep === 'processing' && (
              <div className="py-10 flex flex-col items-center gap-4">
                {ocrPreviews[0] && (
                  <img src={ocrPreviews[0]} alt="preview"
                    className="w-32 rounded-xl border border-slate-100 object-contain opacity-60" />
                )}
                {receiptWasCancelled(receiptJob) || receiptBlockedResults(receiptJob).length > 0 ? (
                  <XCircle size={36} color="#ef4444" />
                ) : receiptJob?.status === 'done' ? (
                  <CheckCircle2 size={36} color="#10b981" />
                ) : (
                  <Loader2 size={36} color="#2C6488" className="animate-spin" />
                )}
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-700">
                    {receiptWasCancelled(receiptJob) ? 'ยกเลิกสแกนแล้ว' : receiptBlockedResults(receiptJob).length > 0 ? 'สแกนเอกสารไม่สำเร็จ' : 'กำลังสแกนเอกสาร...'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {receiptWasCancelled(receiptJob) ? 'รายการที่สแกนนี้ถูกยกเลิกแล้ว' : receiptBlockedResults(receiptJob).length > 0 ? 'ตรวจสอบเหตุผลด้านล่าง แล้วอัปโหลดรูปที่ชัดเจนอีกครั้ง' : 'ระบบกำลังอ่านและแยกประเภทเอกสาร อาจใช้เวลา 10–30 วินาที'}
                  </p>
                </div>
                {receiptWasCancelled(receiptJob) && (
                  <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left">
                    <p className="text-sm font-semibold text-slate-600">ยกเลิกสแกนแล้ว</p>
                    <p className="text-xs text-slate-500 mt-1">ยังไม่มีการบันทึกรายการจากงานนี้</p>
                  </div>
                )}
                {receiptBlockedResults(receiptJob).length > 0 && (
                  <div className="w-full rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-left">
                    <p className="text-sm font-semibold text-red-600">ไม่สามารถอ่านเอกสารนี้ได้</p>
                    <p className="text-xs text-red-500 mt-1">{receiptBlockedMessage(receiptJob)}</p>
                    <div className="mt-3 space-y-2">
                      {receiptBlockedResults(receiptJob).map((result, i) => (
                        <div key={result.id || i} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 border border-red-100 px-2.5 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">ใบที่ {i + 1} {result.filename ? `· ${result.filename}` : ''}</p>
                            <p className="text-[11px] text-red-500 truncate">{result.error_msg || 'อ่านข้อมูลไม่สำเร็จ'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {receiptJob && (
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full bg-[#2C6488] transition-all" style={{ width: `${receiptJob.total_count ? (receiptJob.done_count / receiptJob.total_count) * 100 : 0}%` }} />
                  </div>
                )}
                {receiptJob?.receipts?.length > 1 && (
                  <div className="w-full space-y-2">
                    {receiptJob.receipts.map((result, i) => {
                      const meta = receiptResultStatusMeta(result);
                      const toneClass = meta.tone === 'emerald'
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-600'
                        : meta.tone === 'red'
                          ? 'bg-red-50 border-red-100 text-red-500'
                          : meta.tone === 'amber'
                            ? 'bg-amber-50 border-amber-100 text-amber-600'
                            : meta.tone === 'brand'
                              ? 'bg-[#EAF3F7] border-[#BFD8E4] text-[#2C6488]'
                              : 'bg-slate-50 border-slate-100 text-slate-500';
                      return (
                        <div key={result.id || i} className="rounded-xl border border-slate-100 bg-white px-3 py-2">
                          <div className="flex items-center gap-2">
                            {meta.icon === 'check' && <CheckCircle2 size={15} color="#10b981" />}
                            {meta.icon === 'x' && <XCircle size={15} color={meta.tone === 'red' ? '#ef4444' : '#94a3b8'} />}
                            {meta.icon === 'loader' && <Loader2 size={15} color="#2C6488" className="animate-spin" />}
                            {meta.icon === 'clock' && <Clock size={15} color="#94a3b8" />}
                            <span className="flex-1 text-xs font-semibold text-slate-700 truncate">
                              ใบที่ {i + 1} {result.filename ? `· ${result.filename}` : ''}
                            </span>
                            <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold ${toneClass}`}>
                              {meta.label}
                            </span>
                          </div>
                          {(result.status === 'rejected' || result.status === 'error') && result.error_msg && (
                            <p className="mt-1 pl-6 text-xs text-red-500">{result.error_msg}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-center gap-3">
                  {receiptJob?.id && receiptJob.status !== 'done' && receiptJob.status !== 'cancelled' && (
                    <button onClick={() => cancelReceiptJob(receiptJob.id)} disabled={ocrCancelling[`${ocrSource === 'scan' ? 'scan' : 'receipt'}-${receiptJob.id}`]}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50">
                      {ocrCancelling[`${ocrSource === 'scan' ? 'scan' : 'receipt'}-${receiptJob.id}`] ? 'กำลังยกเลิกสแกน...' : 'ยกเลิกสแกน'}
                    </button>
                  )}
                  <button onClick={closeOcr}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-500 bg-slate-100 hover:bg-slate-200">
                    ปิด
                  </button>
                </div>
              </div>
            )}

            {/* ─── Step: upload ─── */}
            {ocrStep === 'upload' && (
              <>
                <div className="rounded-2xl border border-[#BFD8E4] bg-[#EAF3F7] px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">อัปโหลดรูปเอกสารทางการเงิน</p>
                  <p className="text-xs text-slate-600 mt-1">
                    ระบบจะแยกให้อัตโนมัติว่าเป็นใบเสร็จหรือสลิป แล้วให้ตรวจสอบก่อนบันทึก
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    รองรับ JPG, PNG, HEIC สูงสุด 5 รูปต่อครั้ง ควรถ่ายให้เห็นวันที่ รายการ ยอดเงิน หรือข้อมูลโอนเงินให้ชัดเจน
                  </p>
                </div>
                <div
                  onClick={() => ocrFileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); handleOcrFileSelect(e.dataTransfer.files); }}
                  className="relative border-2 border-dashed border-[#BFD8E4] rounded-2xl overflow-hidden cursor-pointer hover:border-[#2C6488] transition-colors"
                  style={{ minHeight: 180 }}
                >
                  {ocrPreviews.length > 0 ? (
                    <div className="grid grid-cols-5 gap-2 p-3">
                      {ocrPreviews.map((preview, i) => (
                        <div key={i} className="relative group">
                          <img src={preview} alt={`preview ${i + 1}`} className="w-full aspect-[3/4] object-cover rounded-xl border border-slate-100" />
                          <button type="button" onClick={(e) => { e.stopPropagation(); removeOcrFile(i); }}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm">
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                      {ocrPreviews.length < 5 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); ocrFileRef.current?.click(); }}
                          className="aspect-[3/4] rounded-xl border-2 border-dashed border-[#BFD8E4] bg-[#EAF3F7] text-[#2C6488] flex flex-col items-center justify-center gap-1 text-xs font-semibold hover:bg-[#DCE8EE]">
                          <Upload size={18} />
                          เพิ่มรูป
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-[#2C6488]">
                      <ScanLine size={36} color="#2C6488" />
                      <p className="text-sm font-medium text-[#2C6488]">คลิกหรือลากวางรูปเอกสาร</p>
                      <p className="text-xs text-slate-400">สูงสุด 5 ใบ · JPG, PNG, HEIC</p>
                    </div>
                  )}
                </div>

                <p className="text-xs text-[#2C6488] bg-[#EAF3F7] px-3 py-2 rounded-xl border border-[#BFD8E4]">
                  อัปโหลดได้ทั้งใบเสร็จและสลิปในครั้งเดียว ระบบจะแยกประเภทและพาไปหน้าตรวจสอบที่เหมาะสม
                </p>

                <div className="flex gap-3">
                  <button onClick={closeOcr}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ปิด
                  </button>
                  <button onClick={runOcr} disabled={ocrFiles.length === 0 || ocrLoading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] disabled:opacity-50 flex items-center justify-center gap-2">
                    {ocrLoading ? <><Loader2 size={15} className="animate-spin" /> กำลังอ่านใบเสร็จ...</> : `เริ่มสแกน ${ocrFiles.length ? ocrFiles.length + ' รูป' : ''}`}
                  </button>
                </div>
              </>
            )}

            {/* ─── Step: result ─── */}
            {ocrStep === 'result' && ocrData && (
              <>
                {receiptJob?.receipts?.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {receiptJob.receipts.map((result, i) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => result.status === 'done' && applyReceiptResult(result, ocrPreviews[i] || '')}
                        disabled={result.status !== 'done'}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold border flex-shrink-0 ${
                          activeReceiptId === result.id
                            ? 'bg-[#EAF3F7] border-[#BFD8E4] text-[#2C6488]'
                            : result.status === 'rejected'
                              ? 'bg-red-50 border-red-100 text-red-500'
                              : result.status === 'skipped'
                                ? 'bg-amber-50 border-amber-100 text-amber-600'
                              : 'bg-white border-slate-200 text-slate-500'
                        } disabled:opacity-60`}
                      >
                        ใบที่ {i + 1} · {result.status === 'done' ? 'พร้อมตรวจ' : result.status === 'rejected' ? 'ไม่ใช่ใบเสร็จ' : result.status === 'skipped' ? 'ไม่บันทึก' : result.status}
                      </button>
                    ))}
                  </div>
                )}
                {/* Preview รูปค้างไว้เทียบ — กดเพื่อขยาย */}
                {ocrPreview && (
                  <img src={ocrPreview} alt="receipt preview"
                    onClick={() => setOcrZoomImg(ocrPreview)}
                    className="w-full object-contain max-h-40 rounded-xl border border-slate-100 bg-slate-50 cursor-pointer hover:opacity-90 transition-opacity"
                    title="กดเพื่อขยายรูป" />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
                    <input type="date" value={ocrDate} onChange={(e) => setOcrDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">บัญชี</label>
                    <AccSelect value={ocrAccount} onChange={setOcrAccount} accounts={transactionAccounts} />
                  </div>
                </div>

                {/* รายการสินค้า */}
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-2 block">รายการสินค้า</label>
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {ocrItems.map((it, i) => (
                      <div key={i} className={`p-3 rounded-xl border transition-colors ${it.include ? 'border-[#BFD8E4] bg-[#EAF3F7]/60' : 'border-slate-100 bg-slate-50 opacity-50'}`}>
                        {/* ชื่อ + ยอดรวม */}
                        <div className="flex items-center gap-2 mb-2">
                          <input type="checkbox" checked={it.include}
                            onChange={(e) => setOcrItems((prev) => {
                              if (!e.target.checked && !String(it.name || '').trim() && !Number(it.amount || 0) && !String(it.note || '').trim()) {
                                return prev.filter((_, j) => j !== i);
                              }
                              return prev.map((x, j) => j === i ? { ...x, include: e.target.checked } : x);
                            })}
                            className="accent-[#2C6488] flex-shrink-0" />
                          <input value={it.name}
                            placeholder="ชื่อรายการ"
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                            className="flex-1 text-sm font-medium bg-transparent border-b border-slate-200 focus:outline-none focus:border-[#2C6488] text-slate-700 placeholder-slate-400" />
                          <span className="text-sm font-bold text-red-500 whitespace-nowrap flex-shrink-0">
                            ฿{fmt(Number(it.amount || 0))}
                          </span>
                        </div>
                        {/* ราคา */}
                        <div className="ml-6 flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-400">ราคา</span>
                          <input type="number" min="0" value={it.amount}
                            placeholder="0.00"
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                            className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white placeholder-slate-400" />
                          <span className="text-xs text-slate-400">฿</span>
                        </div>
                        {(() => {
                          const adj = receiptItemAdjustmentPreview(it);
                          if (!it.include || (adj.vat <= 0 && adj.discount <= 0)) return null;
                          return (
                            <div className="ml-6 mb-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-500 space-y-0.5">
                              {adj.vat > 0 && (
                                <div className="flex justify-between gap-2">
                                  <span>VAT ที่บวกเพิ่ม</span>
                                  <b className="text-slate-700">+฿{fmt(adj.vat)}</b>
                                </div>
                              )}
                              {adj.discount > 0 && (
                                <div className="flex justify-between gap-2">
                                  <span>ส่วนลดที่กระจายให้รายการนี้</span>
                                  <b className="text-red-500">-฿{fmt(adj.discount)}</b>
                                </div>
                              )}
                              <div className="flex justify-between gap-2 border-t border-slate-100 pt-0.5">
                                <span>ยอดที่จะบันทึก</span>
                                <b className="text-[#2C6488]">฿{fmt(adj.finalAmount)}</b>
                              </div>
                            </div>
                          );
                        })()}
                        {/* หมวดหมู่ */}
                        <div className="ml-6 mb-2">
                          <CatSelect
                            value={it.category_id}
                            onChange={(v) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, category_id: v } : x))}
                            categories={expCats}
                          />
                        </div>
                        {/* หมายเหตุรายการนี้ */}
                        <div className="ml-6">
                          <input value={it.note}
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                            placeholder="หมายเหตุรายการนี้..."
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white text-slate-600 placeholder-slate-300" />
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* ปุ่มเพิ่มรายการ */}
                  <button
                    onClick={() => setOcrItems((prev) => [...prev, {
                      name: '', amount: '', note: '',
                      category_id: expCats[0]?.id || '',
                      include: true,
                    }])}
                    className="mt-2 w-full py-2 rounded-xl border-2 border-dashed border-[#BFD8E4] text-[#2C6488] text-sm font-medium hover:border-[#6F9DB6] hover:bg-[#EAF3F7]/60 transition-colors flex items-center justify-center gap-1"
                  >
                    + เพิ่มรายการ
                  </button>
                </div>

                {(() => {
                  const totals = receiptTotals();
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-slate-500 mb-1 block">ภาษีมูลค่าเพิ่ม</label>
                          <input type="number" min="0" value={ocrVatAmount}
                            onChange={(e) => setOcrVatAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-500 mb-1 block">การคิด VAT</label>
                          <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                            <button type="button" onClick={() => setOcrVatMode('include')}
                              className={`py-2 rounded-lg text-xs font-semibold ${ocrVatMode === 'include' ? 'bg-white text-[#2C6488] shadow-sm' : 'text-slate-500'}`}>
                              รวมแล้ว
                            </button>
                            <button type="button" onClick={() => setOcrVatMode('exclude')}
                              className={`py-2 rounded-lg text-xs font-semibold ${ocrVatMode === 'exclude' ? 'bg-white text-[#2C6488] shadow-sm' : 'text-slate-500'}`}>
                              บวกเพิ่ม
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-slate-500 mb-1 block">ส่วนลดรวม</label>
                          <input type="number" min="0" value={ocrDiscountAmount}
                            onChange={(e) => setOcrDiscountAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-slate-500 mb-1 block">การใช้ส่วนลด</label>
                          <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                            <button type="button" onClick={() => setOcrDiscountMode('prorate')}
                              className={`py-2 rounded-lg text-xs font-semibold ${ocrDiscountMode === 'prorate' ? 'bg-white text-[#2C6488] shadow-sm' : 'text-slate-500'}`}>
                              กระจาย
                            </button>
                            <button type="button" onClick={() => setOcrDiscountMode('ignore')}
                              className={`py-2 rounded-lg text-xs font-semibold ${ocrDiscountMode === 'ignore' ? 'bg-white text-[#2C6488] shadow-sm' : 'text-slate-500'}`}>
                              ไม่ใช้
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl bg-[#EAF3F7] border border-[#BFD8E4] p-3 space-y-1 text-xs">
                        <div className="flex justify-between text-slate-600"><span>รวมรายการ</span><b>฿{fmt(totals.baseTotal)}</b></div>
                        <div className="flex justify-between text-slate-600"><span>VAT บวกเพิ่ม</span><b>฿{fmt(totals.vat)}</b></div>
                        <div className="flex justify-between text-slate-600"><span>ส่วนลด</span><b>-฿{fmt(totals.discount)}</b></div>
                        <div className="flex justify-between text-[#2C6488] text-sm pt-1 border-t border-[#BFD8E4]"><span className="font-semibold">ยอดสุทธิที่จะบันทึก</span><b>฿{fmt(totals.finalTotal)}</b></div>
                      </div>
                    </div>
                  );
                })()}

                <div className="flex gap-3 pt-2">
                  <button onClick={closeOcr}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ปิด
                  </button>
                  <button onClick={skipOcrReceipt} disabled={ocrSkipping[`receipt-${activeReceiptId}`]}
                    className="flex-1 border border-amber-200 bg-amber-50 text-amber-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-100 disabled:opacity-60">
                    {ocrSkipping[`receipt-${activeReceiptId}`] ? 'กำลังข้าม...' : 'ไม่บันทึก'}
                  </button>
                  <button onClick={saveOcrReceipt} disabled={ocrSaving}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: '#2C6488' }}>
                    {ocrSaving ? 'กำลังบันทึก...' : `บันทึก ${ocrItems.filter((x) => x.include).length} รายการ`}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* ── Modal: Batch Slip Scanner ────────────────────────────────────────── */}
      {showSlipScanner && (
        <Modal title={slipJob ? `${slipSource === 'scan' ? 'ตรวจสอบสลิป' : 'สแกนสลิป'} — ${slipJob.done_count}/${slipJob.total_count} เสร็จ` : 'สแกนเอกสาร'} onClose={closeSlipScanner} size="lg">
          <div className="space-y-4">

            {/* ─── Phase 1: upload ─── */}
            {!slipJob && (
              <>
                <div className="rounded-2xl border border-[#BFD8E4] bg-[#EAF3F7] px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">อัปโหลดรูปสลิปโอนเงิน</p>
                  <p className="text-xs text-slate-600 mt-1">
                    ระบบจะอ่านยอดเงิน ผู้โอน ผู้รับ วันที่ เวลา และเลขอ้างอิงให้ก่อนนำไปบันทึก
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    รองรับ JPG, PNG, HEIC สูงสุด 5 รูปต่อครั้ง ควรใช้รูปที่เห็นยอดเงิน ผู้รับ และเลขอ้างอิงชัดเจน
                  </p>
                </div>
                <input
                  ref={slipFileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
                  onChange={(e) => { handleSlipFilesSelect(e.target.files); e.target.value = ''; }}
                />
                <div
                  onClick={() => slipFileRef.current?.click()}
                  onDrop={(e) => { e.preventDefault(); handleSlipFilesSelect(e.dataTransfer.files); }}
                  onDragOver={(e) => e.preventDefault()}
                  className="relative border-2 border-dashed border-[#BFD8E4] rounded-2xl overflow-hidden cursor-pointer hover:border-[#2C6488] transition-colors"
                  style={{ minHeight: 180 }}
                >
                  {slipFiles.length > 0 ? (
                    <div className="grid grid-cols-5 gap-2 p-3">
                      {slipFiles.map((f, i) => (
                        <div key={`${f.name}-${i}`} className="relative group">
                          {slipPreviews[i] ? (
                            <img src={slipPreviews[i]} alt={f.name} className="w-full aspect-[3/4] object-cover rounded-xl border border-slate-100" />
                          ) : (
                            <div className="w-full aspect-[3/4] rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-center">
                              <ImageIcon size={20} color="#cbd5e1" />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeSlipFile(i); }}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
                          >
                            <X size={13} />
                          </button>
                          <div className="absolute bottom-1 left-1 right-1 rounded-lg bg-black/45 px-1.5 py-0.5">
                            <p className="text-[9px] text-white truncate">{f.name}</p>
                          </div>
                        </div>
                      ))}
                      {slipFiles.length < 5 && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); slipFileRef.current?.click(); }}
                          className="aspect-[3/4] rounded-xl border-2 border-dashed border-[#BFD8E4] bg-[#EAF3F7] text-[#2C6488] flex flex-col items-center justify-center gap-1 text-xs font-semibold hover:bg-[#DCE8EE]">
                          <Upload size={18} />
                          เพิ่มรูป
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-[#2C6488]">
                      <ScanLine size={36} color="#2C6488" />
                      <p className="text-sm font-medium text-[#2C6488]">คลิกหรือลากวางรูปสลิป</p>
                      <p className="text-xs text-slate-400">สูงสุด 5 รูป · JPG, PNG, HEIC</p>
                    </div>
                  )}
                </div>

                <p className="text-xs text-[#2C6488] bg-[#EAF3F7] px-3 py-2 rounded-xl border border-[#BFD8E4]">
                  ระบบจะแยกประเภทเอกสารให้อัตโนมัติ หากเป็นสลิปจะเปิดหน้านี้เพื่อให้ตรวจสอบก่อนบันทึก
                </p>

                {slipError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{slipError}</p>}

                <div className="flex gap-3 pt-1">
                  <button onClick={closeSlipScanner}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ปิด
                  </button>
                  <button onClick={startSlipJob} disabled={slipFiles.length === 0 || slipUploading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] disabled:opacity-50 flex items-center justify-center gap-2">
                    {slipUploading
                      ? <><Loader2 size={15} className="animate-spin" /> กำลังอ่านข้อมูลสลิป...</>
                      : `เริ่มสแกน ${slipFiles.length > 0 ? slipFiles.length + ' รูป' : ''}`}
                  </button>
                </div>
              </>
            )}

            {/* ─── Phase 2 & 3: processing / review ─── */}
            {slipJob && (
              <>
                {/* Progress bar */}
                <div className="bg-slate-50 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-500">
                      {slipJob.status === 'done' ? 'สแกนเสร็จแล้ว' : 'กำลังสแกน...'}
                    </span>
                    <span className="text-xs font-semibold text-slate-700">
                      {slipJob.done_count} / {slipJob.total_count} ใบ
                    </span>
                  </div>
                  {slipJob.status !== 'done' && slipJob.status !== 'cancelled' && (
                    <p className="text-xs text-slate-400 mb-2">
                      ระบบกำลังดึงยอดเงิน ผู้รับ และเลขอ้างอิง อาจใช้เวลา 10–30 วินาที
                    </p>
                  )}
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${slipJob.total_count > 0 ? (slipJob.done_count / slipJob.total_count) * 100 : 0}%`,
                        background: '#2C6488',
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {slipJob.status !== 'done' && slipJob.status !== 'cancelled' && (
                      <button onClick={() => cancelSlipJob(slipJob.id)} disabled={ocrCancelling[`${slipSource === 'scan' ? 'scan' : 'slip'}-${slipJob.id}`]}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50">
                        {ocrCancelling[`${slipSource === 'scan' ? 'scan' : 'slip'}-${slipJob.id}`] ? 'กำลังยกเลิกสแกน...' : 'ยกเลิกสแกน'}
                      </button>
                    )}
                    <button onClick={closeSlipScanner}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50">
                      ปิด
                    </button>
                  </div>
                </div>

                {/* Each slip result */}
                <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
                  {(slipJob.slips || []).map((slip, i) => {
                    const rv = slipReview[slip.id];
                    return (
                      <div key={slip.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-100">
                          {slip.status === 'done'    && <CheckCircle2 size={15} color="#10b981" />}
                          {slip.status === 'error'   && <XCircle      size={15} color="#ef4444" />}
                          {slip.status === 'rejected' && <XCircle      size={15} color="#ef4444" />}
                          {slip.status === 'queued'  && <Clock        size={15} color="#94a3b8" />}
                          {(slip.status === 'ocr' || slip.status === 'parsing') && (
                            <Loader2 size={15} color="#2C6488" className="animate-spin" />
                          )}
                          <span className="flex-1 text-xs font-medium text-slate-700 truncate">
                            {slip.filename || `สลิป ${i + 1}`}
                          </span>
                          {slip.is_duplicate && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-semibold flex-shrink-0">
                              ซ้ำ
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            slip.status === 'done'    ? 'bg-emerald-100 text-emerald-600' :
                            slip.status === 'skipped' ? 'bg-amber-100 text-amber-600' :
                            (slip.status === 'error' || slip.status === 'rejected') ? 'bg-red-100 text-red-600'        :
                            slip.status === 'queued'  ? 'bg-slate-100 text-slate-500'    :
                            'bg-[#DCE8EE] text-[#2C6488]'
                          }`}>
                            {slip.status === 'done'    ? 'เสร็จ'     :
                             slip.status === 'error'   ? 'ผิดพลาด'   :
                             slip.status === 'rejected' ? 'Reject'    :
                             slip.status === 'queued'  ? 'รอคิว'     :
                             slip.status === 'ocr'     ? 'กำลังสแกน' :
                             slip.status === 'parsing' ? 'แปลผล'     :
                             slip.status === 'saved'   ? 'บันทึกแล้ว' :
                             slip.status === 'skipped' ? 'ไม่บันทึก' : slip.status}
                          </span>
                        </div>

                        {/* Error message */}
                        {(slip.status === 'error' || slip.status === 'rejected') && (
                          <div className="px-4 py-3 text-xs text-red-500">
                            <p>{slip.error_msg || 'สแกนไม่สำเร็จ'}</p>
                          </div>
                        )}

                        {/* Already saved */}
                        {(slip.status === 'saved' || slipSaved[slip.id]) && (
                          <div className="px-4 py-3 flex items-center gap-2 text-sm text-emerald-600">
                            <CheckCircle2 size={15} />
                            บันทึกเป็นรายรับแล้ว
                          </div>
                        )}
                        {slip.status === 'skipped' && (
                          <div className="px-4 py-3 flex items-center gap-2 text-sm text-amber-600">
                            <XCircle size={15} />
                            ไม่บันทึกรายการนี้
                          </div>
                        )}

                        {/* Done: review form */}
                        {slip.status === 'done' && !slipSaved[slip.id] && rv && (
                          <div className="p-4 flex gap-3">
                            {/* Slip image — คลิกเพื่อขยาย */}
                            {slip.image_path && (
                              <div className="w-24 flex-shrink-0">
                                <img
                                  src={`http://localhost:8080${slip.image_path}`}
                                  alt="slip"
                                  onClick={() => setSlipZoomImg(`http://localhost:8080${slip.image_path}`)}
                                  className="w-full rounded-xl border border-slate-100 object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                  title="คลิกเพื่อดูรูปขนาดใหญ่"
                                />
                                <p className="text-[9px] text-center text-slate-400 mt-1">คลิกเพื่อขยาย</p>
                              </div>
                            )}

                            {/* Form */}
                            <div className="flex-1 space-y-2.5 min-w-0">

                              {/* Type toggle */}
                              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                                {[
                                  { val: 'expense', label: 'รายจ่าย', color: '#ef4444' },
                                  { val: 'income',  label: 'รายรับ',  color: '#10b981' },
                                ].map((opt) => (
                                  <button
                                    key={opt.val}
                                    type="button"
                                    onClick={() => setSlipReview((p) => {
                                      const catForType = opt.val === 'income' ? incCats[0] : expCats[0];
                                      return {
                                        ...p,
                                        [slip.id]: {
                                          ...p[slip.id],
                                          tx_type:     opt.val,
                                          category_id: catForType?.id || '',
                                        },
                                      };
                                    })}
                                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                    style={rv.tx_type === opt.val
                                      ? { background: '#fff', color: opt.color, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }
                                      : { color: '#94a3b8' }}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>

                              {/* Extracted summary */}
                              {(slip.bank || slip.sender || slip.receiver) && (
                                <div className="bg-[#EAF3F7] rounded-xl px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  {slip.bank && (
                                    <div><span className="text-slate-400">ธนาคาร: </span>
                                    <span className="font-medium text-slate-700">{slip.bank}</span></div>
                                  )}
                                  {slip.transaction_date && (
                                    <div><span className="text-slate-400">วันที่: </span>
                                    <span className="font-medium text-slate-700">{formatDisplayDate(slip.transaction_date)}</span></div>
                                  )}
                                  {slip.sender && (
                                    <div><span className="text-slate-400">ผู้โอน: </span>
                                    <span className="font-medium text-slate-700">{slip.sender}</span></div>
                                  )}
                                  {slip.receiver && (
                                    <div><span className="text-slate-400">ผู้รับ: </span>
                                    <span className="font-medium text-slate-700">{slip.receiver}</span></div>
                                  )}
                                </div>
                              )}

                              {/* Amount + Date */}
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[11px] font-medium text-slate-500 mb-1 block">ยอดเงิน (฿)</label>
                                  <input
                                    type="number" min="0" value={rv.amount}
                                    onChange={(e) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], amount: e.target.value } }))}
                                    onBlur={() => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], amount: Number(p[slip.id]?.amount || 0).toFixed(2) } }))}
                                    step="0.01"
                                    className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-sm font-bold bg-slate-50 text-slate-700"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-medium text-slate-500 mb-1 block">วันที่</label>
                                  <input
                                    type="date" value={rv.transaction_date}
                                    onChange={(e) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], transaction_date: e.target.value } }))}
                                    className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-slate-50 text-slate-700"
                                  />
                                </div>
                              </div>

                              {/* Name */}
                              <div>
                                <label className="text-[11px] font-medium text-slate-500 mb-1 block">ชื่อรายการ</label>
                                <input
                                  value={rv.name}
                                  onChange={(e) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], name: e.target.value } }))}
                                  placeholder="เช่น โอนค่าอาหาร, รับเงินค่าจ้าง"
                                  className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-slate-50 text-slate-700 placeholder-slate-300"
                                />
                              </div>

                              {/* Account */}
                              <div>
                                <label className="text-[11px] font-medium text-slate-500 mb-1 block">
                                  {rv.tx_type === 'income' ? 'บัญชีที่รับเงิน' : 'บัญชีที่จ่ายเงิน'}
                                </label>
                                <AccSelect
                                  value={rv.account_id}
                                  onChange={(v) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], account_id: v } }))}
                                  accounts={transactionAccounts}
                                />
                              </div>

                              {/* Category — ตาม type */}
                              <div>
                                <label className="text-[11px] font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
                                <CatSelect
                                  value={rv.category_id}
                                  onChange={(v) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], category_id: v } }))}
                                  categories={rv.tx_type === 'income' ? incCats : expCats}
                                />
                              </div>

                              {/* Note */}
                              <div>
                                <label className="text-[11px] font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                                <input
                                  value={rv.note}
                                  onChange={(e) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], note: e.target.value } }))}
                                  placeholder="บันทึกเพิ่มเติม..."
                                  className="w-full border border-slate-200 rounded-xl px-2 py-1.5 text-sm bg-slate-50 text-slate-700 placeholder-slate-300"
                                />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => skipSlipResult(slip)}
                                  disabled={ocrSkipping[`slip-${slip.id}`]}
                                  className="py-2 rounded-xl text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 disabled:opacity-60"
                                >
                                  {ocrSkipping[`slip-${slip.id}`] ? 'กำลังข้าม...' : 'ไม่บันทึก'}
                                </button>
                                <button
                                  onClick={() => saveSlipResult(slip)}
                                  disabled={slipSaving[slip.id]}
                                  className="py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
                                  style={{
                                    background: slip.is_duplicate
                                      ? '#f59e0b'
                                      : rv.tx_type === 'income' ? '#10b981' : '#ef4444',
                                  }}
                                >
                                  {slipSaving[slip.id]
                                    ? <><Loader2 size={13} className="animate-spin" /> กำลังบันทึก...</>
                                    : slip.is_duplicate
                                      ? '⚠ สลิปซ้ำ — บันทึกต่อไป?'
                                      : rv.tx_type === 'income'
                                        ? 'บันทึกเป็นรายรับ'
                                        : 'บันทึกเป็นรายจ่าย'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {slipError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{slipError}</p>}

                {slipJob.status === 'done' && (
                  <button onClick={closeSlipScanner}
                    className="w-full border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ปิด
                  </button>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* ── Slip image zoom overlay ──────────────────────────────────────────── */}
      {/* ── Receipt image zoom overlay ─────────────────────────────────────── */}
      {ocrZoomImg && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setOcrZoomImg(null)}
        >
          <img
            src={ocrZoomImg}
            alt="receipt zoom"
            className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setOcrZoomImg(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
          >
            <X size={18} color="white" />
          </button>
        </div>
      )}

      {slipZoomImg && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setSlipZoomImg(null)}
        >
          <img
            src={slipZoomImg}
            alt="slip zoom"
            className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setSlipZoomImg(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
          >
            <X size={18} color="white" />
          </button>
        </div>
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
