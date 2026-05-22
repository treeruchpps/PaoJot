import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowLeftRight, Trash2, Edit, Search, X, Download, List, Calendar, ScanLine, Loader2, ChevronDown, DollarSign, Briefcase, Star, Smartphone, TrendingUp, CheckCircle2, XCircle, Clock, Upload, ImageIcon, Wallet } from 'lucide-react';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { transactions as txApi, slipJobs as slipJobsApi, receiptJobs as receiptJobsApi } from '../services/api';
import { fmt } from '../constants/data';

const TYPE_LABEL = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอนเงิน', adjustment: 'ปรับยอด' };
const TYPE_COLOR = { income: '#10b981', expense: '#ef4444', transfer: '#2563eb', adjustment: '#f59e0b' };
const TYPE_BG    = { income: '#f0fdf4', expense: '#fff1f2', transfer: '#eff6ff', adjustment: '#fffbeb' };
const TYPE_ICON  = { income: 'ArrowUp', expense: 'ArrowDown', transfer: 'ArrowLeftRight', adjustment: 'SlidersHorizontal' };
const DAY_TH     = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const TX_PAGE_SIZE = 10;

const FINAL_OCR_STATUSES = ['saved', 'skipped', 'rejected', 'cancelled', 'error'];
const isOcrResultHandled = (result) => FINAL_OCR_STATUSES.includes(result?.status);
const isOcrJobHandled = (job, key) => {
  const results = job?.[key] || [];
  if (job?.status === 'cancelled') return true;
  return results.length > 0 && results.every(isOcrResultHandled);
};
const RECEIPT_BLOCKED_STATUSES = ['rejected', 'error'];
const receiptBlockedResults = (job) => (job?.receipts || []).filter((r) => RECEIPT_BLOCKED_STATUSES.includes(r.status));
const receiptWasCancelled = (job) => job?.status === 'cancelled' || (job?.receipts || []).some((r) => r.status === 'cancelled');
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
      return { label: 'ไม่ใช่ใบเสร็จ', tone: 'red', icon: 'x' };
    case 'error':
      return { label: 'ผิดพลาด', tone: 'red', icon: 'x' };
    case 'cancelled':
      return { label: 'ยกเลิกแล้ว', tone: 'slate', icon: 'x' };
    case 'skipped':
      return { label: 'ไม่บันทึก', tone: 'amber', icon: 'x' };
    case 'saved':
      return { label: 'บันทึกแล้ว', tone: 'emerald', icon: 'check' };
    case 'ocr':
      return { label: 'กำลัง OCR', tone: 'brand', icon: 'loader' };
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
function CatSelect({ value, onChange, categories, placeholder = '— ไม่ระบุ —' }) {
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
          {placeholder && (
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-400 hover:bg-slate-50 transition-colors"
              style={{ background: !value ? '#f8fafc' : undefined }}>
              <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0" />
              <span>{placeholder}</span>
            </button>
          )}
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
              รายการวันที่ {selectedDate}
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
export default function TransactionsView({ accounts, categories, onRefreshAccounts, onGoAccounts }) {
  const today     = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const thisYear  = today.slice(0, 4);
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
  const hasAccounts = (accounts || []).length > 0;

  const [txList,       setTxList]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [viewMode,     setViewMode]     = useState('list');   // 'list' | 'calendar'
  const [showModal,    setShowModal]    = useState(false);
  const [txType,       setTxType]       = useState('expense');
  const [filterMonth,  setFilterMonth]  = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(thisMonth);
  const [filterType,   setFilterType]   = useState('all');
  const [filterAcc,    setFilterAcc]    = useState('all');
  const [search,       setSearch]       = useState('');
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
  };
  const [form, setForm] = useState({
    name: '', amount: '', note: '', category_id: '',
    account_id:       accounts[0]?.id || '',
    from_account_id:  accounts[0]?.id || '',
    to_account_id:    accounts[1]?.id || accounts[0]?.id || '',
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
  const [ocrItems,      setOcrItems]     = useState([]);  // [{ name, quantity, unit_price, note, category_id, include }]
  const [ocrAccount,    setOcrAccount]   = useState('');
  const [ocrDate,       setOcrDate]      = useState(today);
  const [ocrNote,       setOcrNote]      = useState('');
  const [ocrSaving,     setOcrSaving]    = useState(false);
  const [ocrZoomImg,    setOcrZoomImg]   = useState(null);  // URL | null
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── Receipt async job ─────────────────────────────────────────────────────
  const receiptPollRef = useRef(null);
  const [receiptJob, setReceiptJob] = useState(null);
  const [activeReceiptId, setActiveReceiptId] = useState(null);
  const [receiptJobsList, setReceiptJobsList] = useState([]);
  const [slipJobsList, setSlipJobsList] = useState([]);
  const [ocrCancelling, setOcrCancelling] = useState({});
  const [ocrSkipping, setOcrSkipping] = useState({});
  const ocrJobsPollRef = useRef(null);

  const ocrStatusText = (job, key) => {
    const results = job?.[key] || [];
    if (job?.status === 'cancelled') return 'ยกเลิกแล้ว';
    if (results.some((r) => r.status === 'rejected')) return key === 'receipts' ? 'ไม่ใช่ใบเสร็จ' : 'ไม่ใช่สลิป';
    if (results.some((r) => r.status === 'error')) return 'OCR ล้มเหลว';
    if (results.some((r) => r.status === 'done')) return 'OCR เสร็จแล้ว รอตรวจ';
    if (job?.status === 'done') return 'OCR เสร็จแล้ว';
    return 'กำลัง OCR';
  };
  const ocrStatusColor = (job, key) => {
    const results = job?.[key] || [];
    if (job?.status === 'cancelled') return 'text-slate-500';
    if (results.some((r) => r.status === 'rejected' || r.status === 'error')) return 'text-red-500';
    if (results.some((r) => r.status === 'done') || job?.status === 'done') return 'text-emerald-600';
    return 'text-[#2C6488]';
  };

  const openOcrModal = (type) => {
    if (!hasAccounts) return;
    setOcrModal(type); setOcrStep('upload'); setOcrFiles([]); setOcrPreviews([]);
    setOcrPreview(''); setOcrError(''); setOcrData(null); setReceiptJob(null); setActiveReceiptId(null);
    setOcrNote('');
  };

  const closeOcr = () => {
    if (receiptPollRef.current) clearInterval(receiptPollRef.current);
    setOcrModal(null); setOcrStep('upload');
    setOcrFiles([]); setOcrPreviews([]);
    setReceiptJob(null); setActiveReceiptId(null);
    setOcrData(null); setOcrPreview(''); setOcrError('');
    setOcrItems([]); setOcrLoading(false); setOcrZoomImg(null);
  };

  const handleOcrFileSelect = (fileList) => {
    const fileArr = Array.isArray(fileList) ? fileList : Array.from(fileList?.length ? fileList : [fileList]).filter(Boolean);
    const selected = fileArr.slice(0, 5);
    if (selected.length === 0) return;
    setOcrFiles(selected);
    setOcrError('');
    const previews = new Array(selected.length).fill('');
    let loaded = 0;
    selected.forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        previews[i] = e.target.result;
        loaded++;
        if (loaded === selected.length) {
          setOcrPreviews([...previews]);
          setOcrPreview(previews[0] || '');
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const applyReceiptResult = (result, preview = '') => {
    if (!result?.data) return;
    const d = result.data || {};
    setActiveReceiptId(result.id);
    setOcrData(d);
    setOcrPreview(preview || (result.image_path ? `http://localhost:8080${result.image_path}` : ''));
    setOcrDate(d.date || today);
    setOcrAccount(accounts[0]?.id || '');
    setOcrItems((d.items || [])
      .filter((it) => (it.unit_price || 0) > 0)
      .map((it) => ({
        name:        it.name || '',
        quantity:    it.quantity || 1,
        unit_price:  it.unit_price,
        note:        it.note || '',
        category_id: (categories || []).filter((c) => c.type === 'expense')[0]?.id || '',
        include:     true,
      })));
    setOcrStep('result');
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
      setOcrError('OCR เสร็จแล้ว แต่ไม่พบรายการใบเสร็จที่พร้อมบันทึก');
      setOcrStep('processing');
    }
  };

  const runOcr = async () => {
    if (ocrFiles.length === 0) return;
    setOcrLoading(true); setOcrError('');
    try {
      if (ocrModal === 'receipt') {
        // ── Async receipt job ──────────────────────────────────────────────
        const res = await receiptJobsApi.create(ocrFiles);
        const jobId = res.job_id;
        setOcrStep('processing'); // ขั้นตอนกลาง: แสดง spinner ขณะรอ

        const poll = async () => {
          try {
            const job = await receiptJobsApi.get(jobId);
            setReceiptJob(job);
            if (job.status === 'done') {
              clearInterval(receiptPollRef.current);
              showReceiptJobOutcome(job);
            } else if (job.status === 'error') {
              clearInterval(receiptPollRef.current);
              setOcrError(job.error_msg || 'OCR ล้มเหลว');
              setOcrStep('upload');
            }
          } catch { /* keep polling */ }
        };

        await poll();
        receiptPollRef.current = setInterval(poll, 2000);
        receiptJobsApi.list().then(setReceiptJobsList).catch(() => {});
      }
    } catch (err) {
      setOcrError(err.message || 'OCR ล้มเหลว');
      setOcrStep('upload');
    } finally {
      setOcrLoading(false);
    }
  };

  const openReceiptJob = async (jobId) => {
    if (!hasAccounts) return;
    setOcrModal('receipt');
    setOcrStep('processing');
    setOcrError('');
    try {
      const job = await receiptJobsApi.get(jobId);
      showReceiptJobOutcome(job);
    } catch (err) {
      setOcrError(err.message || 'โหลดงาน OCR ไม่สำเร็จ');
    }
  };

  const cancelReceiptJob = async (jobId) => {
    setOcrCancelling((p) => ({ ...p, [`receipt-${jobId}`]: true }));
    try {
      await receiptJobsApi.cancel(jobId);
      if (receiptPollRef.current) clearInterval(receiptPollRef.current);
      if (receiptJob?.id === jobId) {
        const job = await receiptJobsApi.get(jobId).catch(() => null);
        if (job) setReceiptJob(job);
        setOcrStep('processing');
      }
      await refreshOcrJobs();
    } catch (err) {
      setOcrError(err.message || 'ยกเลิกสแกนไม่สำเร็จ');
    } finally {
      setOcrCancelling((p) => ({ ...p, [`receipt-${jobId}`]: false }));
    }
  };

  const saveOcrReceipt = async () => {
    const selected = ocrItems.filter((it) => it.include && it.unit_price > 0);
    if (selected.length === 0) { setOcrError('เลือกรายการอย่างน้อย 1 อัน'); return; }
    setOcrSaving(true); setOcrError('');
    try {
      await Promise.all(selected.map((it) =>
        txApi.create({
          type:             'expense',
          amount:           parseFloat(it.unit_price) * (parseFloat(it.quantity) || 1),
          name:             it.name || null,
          note:             it.note || ocrNote || null,
          category_id:      it.category_id || null,
          account_id:       ocrAccount,
          transaction_date: ocrDate,
        })
      ));
      if (receiptJob?.id && activeReceiptId) {
        await receiptJobsApi.save(receiptJob.id, activeReceiptId);
      }
      await Promise.all([fetchTx(), onRefreshAccounts?.()]);
      if (receiptJob?.id) {
        const updatedJob = await receiptJobsApi.get(receiptJob.id);
        setReceiptJob(updatedJob);
        const nextResult = (updatedJob.receipts || []).find((r) => r.status === 'done');
        if (nextResult) {
          applyReceiptResult(nextResult);
        } else {
          closeOcr();
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
      await receiptJobsApi.skip(receiptJob.id, activeReceiptId);
      const updatedJob = await receiptJobsApi.get(receiptJob.id);
      setReceiptJob(updatedJob);
      const nextResult = (updatedJob.receipts || []).find((r) => r.status === 'done');
      if (nextResult) {
        applyReceiptResult(nextResult);
      } else {
        closeOcr();
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

  const openSlipScanner = () => {
    if (!hasAccounts) return;
    if (slipPollRef.current) clearInterval(slipPollRef.current);
    setSlipFiles([]); setSlipPreviews([]); setSlipJobId(null); setSlipJob(null);
    setSlipUploading(false); setSlipError(''); setSlipSaving({}); setSlipSaved({}); setSlipReview({});
    setShowSlipScanner(true);
  };

  const openSlipJob = async (jobId) => {
    if (!hasAccounts) return;
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
            const expCat = (categories || []).find((c) => c.type === 'expense');
            next[r.id] = {
              tx_type: 'expense',
              account_id: accounts[0]?.id || '',
              category_id: expCat?.id || '',
              name: r.receiver || r.sender || '',
              note: '',
              amount: String(r.amount || ''),
              transaction_date: r.transaction_date || today,
            };
          }
        });
        return next;
      });
    } catch (err) {
      setSlipError(err.message || 'โหลดงาน OCR ไม่สำเร็จ');
    }
  };

  const closeSlipScanner = () => {
    if (slipPollRef.current) clearInterval(slipPollRef.current);
    setShowSlipScanner(false);
  };

  const handleSlipFilesSelect = (fileList) => {
    const fileArr = Array.from(fileList).slice(0, 5);
    setSlipFiles(fileArr);
    setSlipError('');
    const previews = new Array(fileArr.length).fill('');
    let loaded = 0;
    fileArr.forEach((f, i) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        previews[i] = e.target.result;
        loaded++;
        if (loaded === fileArr.length) setSlipPreviews([...previews]);
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

      const poll = async () => {
        try {
          const job = await slipJobsApi.get(jobId);
          setSlipJob(job);
          setSlipReview((prev) => {
            const next = { ...prev };
            (job.slips || []).forEach((r) => {
              if (r.status === 'done' && !next[r.id]) {
                const expCat = (categories || []).find((c) => c.type === 'expense');
                const autoName = r.receiver
                  ? `${r.receiver}`
                  : r.sender
                    ? `${r.sender}`
                    : '';
                next[r.id] = {
                  tx_type:          'expense',
                  account_id:       accounts[0]?.id || '',
                  category_id:      expCat?.id || '',
                  name:             autoName,
                  note:             '',
                  amount:           String(r.amount || ''),
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
    setSlipSaving((p) => ({ ...p, [slip.id]: true }));
    setSlipError('');
    try {
      await slipJobsApi.save(slipJobId, slip.id, {
        tx_type:          rv.tx_type || 'expense',
        account_id:       rv.account_id,
        category_id:      rv.category_id || '',
        amount:           parseFloat(rv.amount),
        name:             rv.name || '',
        transaction_date: rv.transaction_date || today,
        note:             rv.note || '',
        ref_no:           slip.ref_no || '',
        image_path:       slip.image_path || '',
      });
      setSlipSaved((p) => ({ ...p, [slip.id]: true }));
      await onRefreshAccounts?.();
      await fetchTx();
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
      await slipJobsApi.skip(slipJobId, slip.id);
      const job = await slipJobsApi.get(slipJobId);
      setSlipJob(job);
      await refreshOcrJobs();
    } catch (err) {
      setSlipError(err.message || 'ข้ามรายการไม่สำเร็จ');
    } finally {
      setOcrSkipping((p) => ({ ...p, [`slip-${slip.id}`]: false }));
    }
  };

  const cancelSlipJob = async (jobId) => {
    setOcrCancelling((p) => ({ ...p, [`slip-${jobId}`]: true }));
    try {
      await slipJobsApi.cancel(jobId);
      if (slipPollRef.current) clearInterval(slipPollRef.current);
      if (slipJobId === jobId) {
        const job = await slipJobsApi.get(jobId).catch(() => null);
        if (job) setSlipJob(job);
      }
      await refreshOcrJobs();
    } catch (err) {
      setSlipError(err.message || 'ยกเลิกสแกนไม่สำเร็จ');
    } finally {
      setOcrCancelling((p) => ({ ...p, [`slip-${jobId}`]: false }));
    }
  };

  const refreshOcrJobs = useCallback(async () => {
    try {
      const [receiptList, slipList] = await Promise.all([
        receiptJobsApi.list(),
        slipJobsApi.list(),
      ]);
      const [receiptDetails, slipDetails] = await Promise.all([
        Promise.all((receiptList || []).map((job) => receiptJobsApi.get(job.id).catch(() => job))),
        Promise.all((slipList || []).map((job) => slipJobsApi.get(job.id).catch(() => job))),
      ]);
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

  const fetchTx = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 10000 };
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
      const res = await txApi.list(params);
      setTxList(res?.data || []);
    } catch {
      setTxList([]);
    } finally {
      setLoading(false);
    }
  }, [filterMonth, filterType, filterAcc, today, weekStartDate, weekEndDate, selectedMonth, thisYear]);

  useEffect(() => { fetchTx(); }, [fetchTx]);

  // ── Categories ───────────────────────────────────────────────────────────
  const expCats      = (categories || []).filter((c) => c.type === 'expense');
  const incCats      = (categories || []).filter((c) => c.type === 'income');
  const transferCats = (categories || []).filter((c) => c.type === 'transfer');

  // Apply localStorage drag order (pm_cat_order) to a category list
  const applyOrder = (type, cats) => {
    try {
      const orderMap = JSON.parse(localStorage.getItem('pm_cat_order') || '{}');
      const order = orderMap[type];
      if (!order || order.length === 0) return cats;
      const lookup   = Object.fromEntries(cats.map((c) => [c.id, c]));
      const ordered  = order.filter((id) => lookup[id]).map((id) => lookup[id]);
      const remainder = cats.filter((c) => !order.includes(c.id));
      return [...ordered, ...remainder];
    } catch { return cats; }
  };

  const currentCats = txType === 'income'
    ? applyOrder('income',   incCats)
    : txType === 'transfer'
      ? applyOrder('transfer', transferCats)
      : applyOrder('expense',  expCats);

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
      ? applyOrder('income',   incCats)
      : type === 'transfer'
        ? applyOrder('transfer', transferCats)
        : applyOrder('expense',  expCats);
    setForm({
      name: '', amount: '', note: '',
      category_id:      cats[0]?.id || '',
      account_id:       accounts[0]?.id || '',
      from_account_id:  accounts[0]?.id || '',
      to_account_id:    accounts[1]?.id || accounts[0]?.id || '',
      transaction_date: today,
    });
    setShowModal(true);
  };

  // ── Edit transaction ──────────────────────────────────────────────────────
  const openEdit = (tx) => {
    // Adjustment → เปิด modal ปรับยอดบัญชีตรงๆ เหมือนหน้าบัญชี/กระเป๋าเงิน
    if (tx.type === 'adjustment') return;
    setTxType(tx.type);
    setEditId(tx.id);
    setError('');
    setForm({
      name:             tx.name  || '',
      amount:           String(tx.amount),
      note:             tx.note  || '',
      category_id:      tx.category_id      || '',
      account_id:       tx.account_id       || accounts[0]?.id || '',
      from_account_id:  tx.account_id       || accounts[0]?.id || '',
      to_account_id:    tx.to_account_id    || accounts[1]?.id || accounts[0]?.id || '',
      transaction_date: tx.transaction_date?.slice(0, 10) || today,
    });
    setShowModal(true);
  };

  // ── Save adjust balance ───────────────────────────────────────────────────
  const save = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('กรุณาใส่จำนวนเงิน'); return; }
    if (txType === 'transfer' && form.from_account_id === form.to_account_id) {
      setError('บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        type:             txType,
        amount:           parseFloat(form.amount),
        name:             form.name || null,
        note:             form.note || null,
        transaction_date: form.transaction_date,
      };
      if (txType === 'transfer') {
        body.account_id    = form.from_account_id;
        body.to_account_id = form.to_account_id;
        body.category_id   = form.category_id || null;
      } else {
        body.account_id  = form.account_id;
        body.category_id = form.category_id || null;
      }
      if (editId) {
        await txApi.update(editId, body);
      } else {
        await txApi.create(body);
      }
      await Promise.all([fetchTx(), onRefreshAccounts?.()]);
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
      await Promise.all([fetchTx(), onRefreshAccounts?.()]);
      setDeleteTarget(null);
    } catch (err) { alert(err.message); }
    finally { setDeleting(false); }
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['วันที่', 'ประเภท', 'หมวดหมู่', 'บัญชี', 'หมายเหตุ', 'จำนวน (฿)'];
    const rows = displayList.map((tx) => {
      const cat   = getCat(tx.category_id);
      const acc   = getAcc(tx.account_id);
      const toAcc = getAcc(tx.to_account_id);
      const sign  = tx.type === 'expense' ? '-' : tx.type === 'adjustment' ? '' : '+';
      return [
        tx.transaction_date?.slice(0, 10) || '',
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
  };

  // ── Search + sort (client-side) ───────────────────────────────────────────
  const searchedList = search.trim() === '' ? txList : txList.filter((tx) => {
    const q = search.trim().toLowerCase();
    const nameMatch   = (tx.name  || '').toLowerCase().includes(q);
    const noteMatch   = (tx.note  || '').toLowerCase().includes(q);
    const amountMatch = String(tx.amount).includes(q);
    return nameMatch || noteMatch || amountMatch;
  });
  const displayList = [...searchedList].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    const getValue = (tx) => {
      if (sortBy === 'amount') return Number(tx.amount) || 0;
      if (sortBy === 'type') return TYPE_LABEL[tx.type] || tx.type || '';
      if (sortBy === 'account') return getAcc(tx.account_id)?.name || '';
      if (sortBy === 'name') return tx.name || tx.note || '';
      return tx.transaction_date || '';
    };
    const av = getValue(a);
    const bv = getValue(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
    return String(av).localeCompare(String(bv), 'th') * direction;
  });
  const totalPages = Math.max(1, Math.ceil(displayList.length / TX_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * TX_PAGE_SIZE;
  const paginatedList = displayList.slice(pageStart, pageStart + TX_PAGE_SIZE);
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((page) => totalPages <= 7 || page === 1 || page === totalPages || Math.abs(page - safePage) <= 1);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterMonth, selectedMonth, filterType, filterAcc, search, sortBy, sortDir, viewMode]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  // ── Summary (from transactions) ───────────────────────────────────────────
  const totalIncome  = (txList || []).filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = (txList || []).filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
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

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'รายได้',  value: totalIncome,  color: '#10b981', bg: '#f0fdf4' },
          { label: 'รายจ่าย', value: totalExpense, color: '#ef4444', bg: '#fff1f2' },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl p-4 border" style={{ background: s.bg, borderColor: s.color + '40' }}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className="text-xl font-bold" style={{ color: s.color }}>
              ฿{fmt(s.value)}
            </p>
          </div>
        ))}
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

          {/* Add buttons */}
          {['income', 'expense', 'transfer'].map((t) => (
            <button key={t} onClick={() => openAdd(t)} disabled={!hasAccounts} title={!hasAccounts ? 'ต้องสร้างบัญชีก่อน' : ''}
              className={`text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border transition-opacity ${!hasAccounts ? 'opacity-45 cursor-not-allowed' : ''}`}
              style={{ color: TYPE_COLOR[t], background: TYPE_BG[t], borderColor: TYPE_COLOR[t] + '33' }}>
              {TYPE_ICON[t] === 'ArrowUp' && <ArrowUp size={13} color={TYPE_COLOR[t]} />}
              {TYPE_ICON[t] === 'ArrowDown' && <ArrowDown size={13} color={TYPE_COLOR[t]} />}
              {TYPE_ICON[t] === 'ArrowLeftRight' && <ArrowLeftRight size={13} color={TYPE_COLOR[t]} />}
              {TYPE_LABEL[t]}
            </button>
          ))}

          {/* OCR ปุ่มแยก 2 ปุ่ม */}
          <input ref={ocrFileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
            onChange={(e) => { handleOcrFileSelect(e.target.files); e.target.value = ''; }} />

          <button onClick={() => openOcrModal('receipt')} disabled={!hasAccounts} title={!hasAccounts ? 'ต้องสร้างบัญชีก่อน' : ''}
            className={`text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors ${!hasAccounts ? 'opacity-45 cursor-not-allowed hover:bg-sky-50' : ''}`}>
            <ScanLine size={13} />
            สแกนใบเสร็จ
          </button>
          <button onClick={openSlipScanner} disabled={!hasAccounts} title={!hasAccounts ? 'ต้องสร้างบัญชีก่อน' : ''}
            className={`text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors ${!hasAccounts ? 'opacity-45 cursor-not-allowed hover:bg-sky-50' : ''}`}>
            <ScanLine size={13} />
            สแกนสลิป
          </button>

          {/* Export CSV */}
          <button onClick={exportCSV}
            className="text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors">
            <Download size={13} color="#64748b" />
            Export CSV
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
      {hasAccounts && [...receiptJobsList, ...slipJobsList].length > 0 && (
        <div className="rounded-xl border border-[#DCE8EE] bg-white px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-[#2C6488]" />
              <p className="text-xs font-semibold text-slate-700">งาน OCR</p>
            </div>
            <button onClick={refreshOcrJobs} className="text-[11px] font-medium text-[#2C6488] hover:underline">รีเฟรช</button>
          </div>
          <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
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
            {search ? `${displayList.length} / ${txList.length}` : `${txList.length}`} รายการ
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
                        {tx.transaction_date?.slice(0, 10) || ''}
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
              {displayList.length > TX_PAGE_SIZE && (
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50">
                  <p className="text-xs text-slate-500">
                    แสดง {pageStart + 1}-{Math.min(pageStart + TX_PAGE_SIZE, displayList.length)} จาก {displayList.length} รายการ
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
                  accounts={accounts}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">จากบัญชี</label>
                  <AccSelect
                    value={form.from_account_id}
                    onChange={(v) => setForm({ ...form, from_account_id: v })}
                    accounts={accounts}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">ไปยังบัญชี</label>
                  <AccSelect
                    value={form.to_account_id}
                    onChange={(v) => setForm({ ...form, to_account_id: v })}
                    accounts={accounts}
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

      {/* ── Modal: OCR ใบเสร็จ ───────────────────────────────────────────────── */}
      {ocrModal === 'receipt' && (
        <Modal title="สแกนใบเสร็จ" onClose={closeOcr} size="lg">
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
                    {receiptWasCancelled(receiptJob) ? 'ยกเลิกสแกนแล้ว' : receiptBlockedResults(receiptJob).length > 0 ? 'สแกนใบเสร็จไม่สำเร็จ' : 'กำลังสแกนใบเสร็จ...'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {receiptWasCancelled(receiptJob) ? 'งาน OCR นี้ถูกยกเลิกแล้ว' : receiptBlockedResults(receiptJob).length > 0 ? 'ตรวจสอบข้อความด้านล่าง หรือเลือกเมนูสแกนที่ถูกต้อง' : 'OCR + แปลผล อาจใช้เวลา 10–30 วินาที'}
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
                    <p className="text-sm font-semibold text-red-600">ไม่ใช่ใบเสร็จ</p>
                    <p className="text-xs text-red-500 mt-1">{receiptBlockedMessage(receiptJob)}</p>
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
                    <button onClick={() => cancelReceiptJob(receiptJob.id)} disabled={ocrCancelling[`receipt-${receiptJob.id}`]}
                      className="px-4 py-2 rounded-xl text-sm font-semibold text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50">
                      {ocrCancelling[`receipt-${receiptJob.id}`] ? 'กำลังยกเลิกสแกน...' : 'ยกเลิกสแกน'}
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
                <div
                  onDoubleClick={() => ocrFileRef.current?.click()}
                  className="relative border-2 border-dashed border-sky-200 rounded-2xl overflow-hidden cursor-pointer hover:border-sky-400 transition-colors"
                  style={{ minHeight: 180 }}
                >
                  {ocrPreviews.length > 0 ? (
                    <div className="grid grid-cols-5 gap-2 p-3">
                      {ocrPreviews.map((preview, i) => (
                        <img key={i} src={preview} alt="preview" className="w-full aspect-[3/4] object-cover rounded-xl border border-slate-100" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 text-sky-300">
                      <ScanLine size={36} />
                      <p className="text-sm font-medium text-sky-500">คลิกหรือลากวางรูปใบเสร็จ</p>
                      <p className="text-xs text-slate-400">สูงสุด 5 ใบ · JPG, PNG, HEIC</p>
                    </div>
                  )}
                </div>

                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl border border-amber-100">
                  รองรับเฉพาะรายจ่ายเท่านั้น
                </p>

                <div className="flex gap-3">
                  <button onClick={closeOcr}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ปิด
                  </button>
                  <button onClick={runOcr} disabled={ocrFiles.length === 0 || ocrLoading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: '#0284c7' }}>
                    {ocrLoading ? <><Loader2 size={15} className="animate-spin" /> กำลังอ่าน...</> : 'สแกน'}
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
                    <AccSelect value={ocrAccount} onChange={setOcrAccount} accounts={accounts} />
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
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))}
                            className="accent-[#2C6488] flex-shrink-0" />
                          <input value={it.name}
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                            className="flex-1 text-sm font-medium bg-transparent border-b border-slate-200 focus:outline-none focus:border-[#2C6488] text-slate-700" />
                          <span className="text-sm font-bold text-red-500 whitespace-nowrap flex-shrink-0">
                            ฿{fmt(parseFloat(it.unit_price || 0) * parseFloat(it.quantity || 1))}
                          </span>
                        </div>
                        {/* จำนวน × ราคา */}
                        <div className="ml-6 flex items-center gap-2 mb-2">
                          <span className="text-xs text-slate-400">จำนวน</span>
                          <input type="number" min="0" value={it.quantity}
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                            className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs text-center bg-white" />
                          <span className="text-xs text-slate-400">× ราคา</span>
                          <input type="number" min="0" value={it.unit_price}
                            onChange={(e) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))}
                            className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white" />
                          <span className="text-xs text-slate-400">฿</span>
                        </div>
                        {/* หมวดหมู่ */}
                        <div className="ml-6 mb-2">
                          <CatSelect
                            value={it.category_id}
                            onChange={(v) => setOcrItems((prev) => prev.map((x, j) => j === i ? { ...x, category_id: v } : x))}
                            categories={(categories || []).filter((c) => c.type === 'expense')}
                            placeholder="— ไม่ระบุหมวดหมู่ —"
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
                      name: '', quantity: 1, unit_price: '', note: '',
                      category_id: (categories || []).filter((c) => c.type === 'expense')[0]?.id || '',
                      include: true,
                    }])}
                    className="mt-2 w-full py-2 rounded-xl border-2 border-dashed border-[#BFD8E4] text-[#2C6488] text-sm font-medium hover:border-[#6F9DB6] hover:bg-[#EAF3F7]/60 transition-colors flex items-center justify-center gap-1"
                  >
                    + เพิ่มรายการ
                  </button>
                </div>

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
        <Modal title={slipJob ? `สแกนสลิป — ${slipJob.done_count}/${slipJob.total_count} เสร็จ` : 'สแกนสลิปธนาคาร'} onClose={closeSlipScanner} size="lg">
          <div className="space-y-4">

            {/* ─── Phase 1: upload ─── */}
            {!slipJob && (
              <>
                <input
                  ref={slipFileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden"
                  onChange={(e) => { handleSlipFilesSelect(e.target.files); e.target.value = ''; }}
                />
                <div
                  onClick={() => slipFileRef.current?.click()}
                  onDrop={(e) => { e.preventDefault(); handleSlipFilesSelect(e.dataTransfer.files); }}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-sky-200 rounded-2xl p-6 text-center cursor-pointer hover:border-sky-400 transition-colors"
                >
                  <Upload size={30} color="#7dd3fc" style={{ margin: '0 auto 8px' }} />
                  <p className="text-sm font-medium text-sky-500">คลิกหรือลากวางรูปสลิป</p>
                  <p className="text-xs text-slate-400 mt-1">สูงสุด 5 ใบ · JPG, PNG, HEIC</p>
                </div>

                {slipFiles.length > 0 && (
                  <div className="grid grid-cols-5 gap-2">
                    {slipFiles.map((f, i) => (
                      <div key={i} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50"
                        style={{ aspectRatio: '3/4' }}>
                        {slipPreviews[i] ? (
                          <img src={slipPreviews[i]} alt={f.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon size={20} color="#cbd5e1" />
                          </div>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSlipFile(i); }}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow"
                        >
                          <X size={10} color="white" />
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1 py-0.5">
                          <p className="text-[9px] text-white truncate">{f.name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {slipError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{slipError}</p>}

                <div className="flex gap-3 pt-1">
                  <button onClick={closeSlipScanner}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ปิด
                  </button>
                  <button onClick={startSlipJob} disabled={slipFiles.length === 0 || slipUploading}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: '#0284c7' }}>
                    {slipUploading
                      ? <><Loader2 size={15} className="animate-spin" /> กำลังอัปโหลด...</>
                      : `เริ่มสแกน ${slipFiles.length > 0 ? slipFiles.length + ' ใบ' : ''}`}
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
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${slipJob.total_count > 0 ? (slipJob.done_count / slipJob.total_count) * 100 : 0}%`,
                        background: '#0284c7',
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    {slipJob.status !== 'done' && slipJob.status !== 'cancelled' && (
                      <button onClick={() => cancelSlipJob(slipJob.id)} disabled={ocrCancelling[`slip-${slipJob.id}`]}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50">
                        {ocrCancelling[`slip-${slipJob.id}`] ? 'กำลังยกเลิกสแกน...' : 'ยกเลิกสแกน'}
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
                             slip.status === 'queued'  ? 'รอคิว'     :
                             slip.status === 'ocr'     ? 'กำลัง OCR' :
                             slip.status === 'parsing' ? 'แปลผล'     :
                             slip.status === 'saved'   ? 'บันทึกแล้ว' :
                             slip.status === 'skipped' ? 'ไม่บันทึก' : slip.status}
                          </span>
                        </div>

                        {/* Error message */}
                        {(slip.status === 'error' || slip.status === 'rejected') && (
                          <div className="px-4 py-3 text-xs text-red-500">
                            {slip.error_msg || 'OCR ล้มเหลว'}
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
                                      const catForType = (categories || []).find((c) => c.type === opt.val);
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
                              {(slip.bank || slip.sender || slip.receiver || slip.ref_no) && (
                                <div className="bg-sky-50 rounded-xl px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  {slip.bank && (
                                    <div><span className="text-slate-400">ธนาคาร: </span>
                                    <span className="font-medium text-slate-700">{slip.bank}</span></div>
                                  )}
                                  {slip.transaction_date && (
                                    <div><span className="text-slate-400">วันที่: </span>
                                    <span className="font-medium text-slate-700">{slip.transaction_date}</span></div>
                                  )}
                                  {slip.sender && (
                                    <div><span className="text-slate-400">ผู้โอน: </span>
                                    <span className="font-medium text-slate-700">{slip.sender}</span></div>
                                  )}
                                  {slip.receiver && (
                                    <div><span className="text-slate-400">ผู้รับ: </span>
                                    <span className="font-medium text-slate-700">{slip.receiver}</span></div>
                                  )}
                                  {slip.ref_no && (
                                    <div className="col-span-2"><span className="text-slate-400">Ref No.: </span>
                                    <span className="font-medium text-slate-700">{slip.ref_no}</span></div>
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
                                  accounts={accounts}
                                />
                              </div>

                              {/* Category — ตาม type */}
                              <div>
                                <label className="text-[11px] font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
                                <CatSelect
                                  value={rv.category_id}
                                  onChange={(v) => setSlipReview((p) => ({ ...p, [slip.id]: { ...p[slip.id], category_id: v } }))}
                                  categories={(categories || []).filter((c) => c.type === rv.tx_type)}
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
