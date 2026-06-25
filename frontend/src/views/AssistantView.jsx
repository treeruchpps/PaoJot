import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  MessageCircle, Sparkles, AlertCircle, CheckCircle2,
  Repeat2, PiggyBank, RefreshCw, HelpCircle,
  Lightbulb, BarChart2, ArrowRight, Check, Edit3,
  CreditCard, TrendingUp, AlertTriangle, Info, Calendar, ImagePlus, Image,
  ChevronDown, Trash2, ArrowUp, ArrowDown, ArrowLeftRight, Plus, Maximize2, X, Camera
} from 'lucide-react';
import { 
  quickEntry, savingsGoals, transactions, budgets as budgetsApi, 
  notifications as notiApi, aiSummary as aiSummaryApi, scanJobs as scanJobsApi, profile as profileApi
} from '../services/api';
import Icon from '../components/common/Icon';
import { fmt } from '../constants/data';
import { getTransactionAccounts } from '../utils/accountFilters';
import { convertHeicFilesToJpeg } from '../utils/heicToJpeg';
import { applySavedCategoryOrder } from '../utils/categoryOrder';
import { formatDisplayDateRange } from '../utils/dateFormat';
import { getCategoryStyle } from '../constants/categoryStyles';

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (s) => {
  if (!s) return '-';
  const parts = String(s).split('-');
  if (parts.length !== 3) return s;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};
const messageId = () => crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const API_BASE_URL = 'http://localhost:8080';

const scanImageSrc = (image) => {
  if (!image) return '';
  if (image.preview_url) return image.preview_url;
  if (image.image_path) {
    return image.image_path.startsWith('http') ? image.image_path : `${API_BASE_URL}${image.image_path}`;
  }
  return image.url || '';
};

const MODE_META = {
  expense: { label: 'รายจ่าย', tone: '#ef4444', bg: '#fff1f2', placeholder: 'เช่น กาแฟ 50 หรือ ข้าวกะเพรา 60' },
  income: { label: 'รายรับ', tone: '#10b981', bg: '#f0fdf4', placeholder: 'เช่น เงินเดือน 30000 หรือ ค่าขนม 500' },
  saving: { label: 'การออม', tone: '#0ea5e9', bg: '#e0f2fe', placeholder: 'เช่น ออม 500 หรือ หยอดกระปุก 100' },
  transfer: { label: 'การโอน', tone: '#2563eb', bg: '#eff6ff', placeholder: 'เช่น โอน 300' },
};

const firstBotMessage = (mode) => ({
  id: messageId(),
  role: 'bot',
  text: `ยินดีต้อนรับเข้าสู่แชท PaoJot ครับ พิมพ์รายการเพื่อจดบันทึก หรือส่งรูปภาพสลิป/ใบเสร็จเพื่อจำแนกสแกนได้เลยครับ`,
});

// ตรวจว่าเป็น error ชั่วคราวจากฝั่ง AI (โหลดหนัก/ไม่ว่าง/timeout) ที่ลองใหม่แล้วมักหาย
const isTransientAiError = (err) => {
  if ([429, 500, 502, 503, 504].includes(err?.status)) return true;
  const text = (err?.message || '').toLowerCase();
  return /\b(429|5\d\d)\b|unavailable|overload|high demand|temporarily|try again|timeout|timed out|rate limit/.test(text);
};

const getAiSummaryFailureMessage = (err) => {
  const text = err?.message || '';
  // ข้อมูลธุรกรรมไม่พอสำหรับสรุป
  if (text.includes('รายการรายรับ/รายจ่าย') || text.includes('ข้อมูลธุรกรรมไม่เพียงพอ')) {
    return 'ยังมีรายการรายรับ/รายจ่ายไม่เพียงพอสำหรับสรุปด้วย AI ครับ ลองบันทึกรายการเพิ่มก่อนแล้วค่อยสร้างสรุปอีกครั้ง';
  }
  // โหลดหนัก/ไม่ว่างชั่วคราว — ไม่โชว์ error ดิบจากผู้ให้บริการ
  if (isTransientAiError(err)) {
    return 'ระบบ AI กำลังมีผู้ใช้งานหนาแน่นชั่วคราว กรุณาลองสร้างสรุปอีกครั้งในอีกสักครู่ครับ';
  }
  return 'ไม่สามารถสร้างสรุปได้ในขณะนี้ กรุณาลองใหม่อีกครั้งครับ';
};

const aiNotificationPeriod = (type) => {
  if (type === 'ai_weekly') return 'weekly';
  if (type === 'ai_monthly') return 'monthly';
  return '';
};

// notification ที่ไม่ต้องการให้แสดงในหน้าแชท (ยังโชว์ใน panel กระดิ่งตามปกติ)
const CHAT_HIDDEN_NOTI_TYPES = new Set(['goal_due', 'budget_near_limit', 'budget_over']);
const isChatHiddenNoti = (type) => CHAT_HIDDEN_NOTI_TYPES.has(type);

const closeChoiceMessages = (messages, targetId = null) =>
  messages.map((msg) => {
    const isTarget = targetId ? msg.id === targetId : true;
    const canClose = targetId
      ? isTarget && (msg.choiceActive || msg.actions)
      : msg.choiceActive;
    return canClose ? { ...msg, choiceActive: false } : msg;
  });

// Component: Budget Impact progress bar overlay
function BudgetImpactBar({ categoryId, amount, budgets = [], categories = [], readonly = false }) {
  if (!categoryId || amount <= 0) return null;
  const cat = categories.find((c) => c.id === categoryId);
  
  // Find active budget for this category
  const today = new Date().toISOString().slice(0, 10);
  const budget = budgets.find(
    (b) => b.category_id === categoryId && b.is_active && b.end_date >= today
  );

  if (!budget) {
    return (
      <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100 dark:bg-slate-800/40 dark:border-slate-700/40 text-[11px] text-slate-400 flex items-center gap-1.5">
        <Lightbulb size={13} className="text-yellow-500 flex-shrink-0" />
        <span>ยังไม่ได้ตั้งงบประมาณสำหรับหมวดหมู่ {cat?.name || 'นี้'}</span>
      </div>
    );
  }

  const spent = budget.spent || 0;
  const limit = budget.amount;
  const pctBefore = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
  const projectedSpent = readonly ? spent : spent + amount;
  const pctAfter = limit > 0 ? Math.min(100, Math.round((projectedSpent / limit) * 100)) : 0;
  
  const spentWidth = `${Math.min(100, (spent / limit) * 100)}%`;
  const additionWidth = readonly ? '0%' : `${Math.min(100 - (spent / limit) * 100, (amount / limit) * 100)}%`;
  const isOver = projectedSpent > limit;
  const overAmount = projectedSpent - limit;

  return (
    <div className="mt-3 p-4 rounded-xl bg-slate-50 border border-slate-200/60 dark:bg-slate-850 dark:border-slate-700/50 space-y-3">
      <div className="flex justify-between items-center gap-3 text-xs">
        <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 min-w-0">
          <BarChart2 size={13} className="text-[#2C6488] dark:text-[#4da2db] flex-shrink-0" />
          <span className="truncate">ผลกระทบต่องบประมาณ: {cat?.name}</span>
        </span>
        <span className="text-[11px] text-slate-400 font-medium flex-shrink-0 whitespace-nowrap">
          วงเงิน ฿{fmt(limit)}
        </span>
      </div>

      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden flex">
        <div 
          className="h-full bg-[#2C6488] transition-all duration-300"
          style={{ width: spentWidth }}
        />
        <div 
          className="h-full bg-amber-400 animate-pulse transition-all duration-300"
          style={{ width: additionWidth }}
        />
      </div>

      <div className="flex justify-between items-center text-[11px]">
        <span className="text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 flex-wrap">
          ใช้ไปแล้ว ฿{fmt(spent)} ({pctBefore}%) {!readonly && amount > 0 && (
            <>
              + ฿{fmt(amount)} <ArrowRight size={11} className="inline text-slate-400" /> ฿{fmt(projectedSpent)} ({pctAfter}%)
            </>
          )}
        </span>
        {isOver && (
          <span className="text-red-500 font-semibold animate-pulse">
            เกินงบไป ฿{fmt(overAmount)}!
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Scan-bubble account-kind helpers ────────────────────────────────────────
const SCAN_ACC_KIND_META = {
  cash:         { icon: 'DollarSign', color: '#10b981' },
  bank_account: { icon: 'Briefcase',  color: '#2C6488' },
  savings:      { icon: 'Star',       color: '#f59e0b' },
  e_wallet:     { icon: 'Smartphone', color: '#2C6488' },
  investment:   { icon: 'TrendingUp', color: '#5F9A7A' },
};

// ─── ScanCatSelect ───────────────────────────────────────────────────────────
function ScanCatSelect({ value, onChange, categories, compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = categories.find((c) => String(c.id) === String(value));
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const btnCls = compact
    ? 'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[#DCE8EE] bg-white text-[11px] text-slate-700 hover:border-[#BFD8E4] transition-colors'
    : 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-[#DCE8EE] bg-white text-xs text-slate-700 hover:border-[#BFD8E4] transition-colors';
  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className={btnCls}>
        {selected ? (
          <>
            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: getCategoryStyle(selected).color + '25' }}>
              <Icon name={getCategoryStyle(selected).icon} size={11} color={getCategoryStyle(selected).color} />
            </div>
            <span className="flex-1 text-left font-medium truncate">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-slate-400">หมวดหมู่</span>
        )}
        <ChevronDown size={11} color="#94a3b8"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {categories.map((c) => {
            const cStyle = getCategoryStyle(c);
            return (
            <button key={c.id} type="button" onClick={() => { onChange(c.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs hover:bg-slate-50 transition-colors"
              style={{ background: String(value) === String(c.id) ? cStyle.color + '10' : undefined }}>
              <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ background: cStyle.color + '25' }}>
                <Icon name={cStyle.icon} size={11} color={cStyle.color} />
              </div>
              <span className="flex-1 text-left font-medium"
                style={{ color: String(value) === String(c.id) ? cStyle.color : '#374151' }}>
                {c.name}
              </span>
              {String(value) === String(c.id) && (
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cStyle.color }} />
              )}
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ScanAccSelect ───────────────────────────────────────────────────────────
function ScanAccSelect({ value, onChange, accounts }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = accounts.find((a) => String(a.id) === String(value));
  const km = (kind) => SCAN_ACC_KIND_META[kind] || { icon: 'DollarSign', color: '#94a3b8' };
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} className="relative w-full">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-[#DCE8EE] bg-white text-xs text-slate-700 hover:border-[#BFD8E4] transition-colors">
        {selected ? (
          <>
            <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: km(selected.kind).color + '25' }}>
              <Icon name={km(selected.kind).icon} size={11} color={km(selected.kind).color} />
            </div>
            <span className="flex-1 text-left font-medium truncate">{selected.name}</span>
            <span className="text-[10px] font-semibold flex-shrink-0 text-slate-500">฿{fmt(selected.balance)}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-slate-400">เลือกบัญชี</span>
        )}
        <ChevronDown size={11} color="#94a3b8"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {accounts.map((a) => (
            <button key={a.id} type="button" onClick={() => { onChange(a.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-xs hover:bg-slate-50 transition-colors"
              style={{ background: String(value) === String(a.id) ? km(a.kind).color + '10' : undefined }}>
              <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ background: km(a.kind).color + '25' }}>
                <Icon name={km(a.kind).icon} size={11} color={km(a.kind).color} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-medium truncate"
                  style={{ color: String(value) === String(a.id) ? km(a.kind).color : '#374151' }}>{a.name}</p>
                <p className="text-[10px] text-slate-500">฿{fmt(a.balance)}</p>
              </div>
              {String(value) === String(a.id) && (
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: km(a.kind).color }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// Client-side quick parse: extract amount + title without LLM (used on category timeout)
function quickParseFallback(mode, text) {
  const amountRe = /\d+(?:[,.]\d+)?/g;
  const matches = [...text.matchAll(amountRe)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const amount = parseFloat(last[0].replace(',', ''));
  if (!amount || amount <= 0) return null;
  let title = text.slice(0, last.index).replace(/บาท\s*$/, '').trim();
  if (!title) title = mode === 'income' ? 'รายรับ' : mode === 'saving' ? 'ออมเงิน' : mode === 'transfer' ? 'โอนเงิน' : 'รายจ่าย';
  return { mode, amount, title, category_id: null, confidence: 0.3, needs_review: true };
}

export default function AssistantView({ accounts = [], categories = [], notifications: sharedNotifications = [], onRefresh, onGoAccounts, onGoGoals, onGoProfile }) {
  const [mode, setMode] = useState('expense');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => [firstBotMessage('expense')]);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [goals, setGoals] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  // ความพร้อมของการสรุป AI ต่อรอบ (current period) — ใช้เปิด/ปิดปุ่มในหน้าแชท
  const [aiEligibility, setAiEligibility] = useState({ weekly: null, monthly: null });
  
  // Custom transaction editing state inside preview cards
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [parsed, setParsed] = useState(null);
  
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const chatBottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const prevMsgCountRef = useRef(0);
  const scanFileRef = useRef(null);
  const cameraInputRef = useRef(null);
  const scanPreviewUrlsRef = useRef([]);
  const preValidatedRef = useRef(null);
  const aiSummaryNotificationFetchRef = useRef(new Set());



  // AI Summary state
  const [aiLoading, setAiLoading] = useState(false);
  const [scanUploading, setScanUploading] = useState(false);
  const [scanJobDetails, setScanJobDetails] = useState({});
  const [scanReview, setScanReview] = useState({});
  const [scanSaving, setScanSaving] = useState({});
  const [scanBulkSaving, setScanBulkSaving] = useState(false);
  const [scanEditMode, setScanEditMode] = useState({});
  const [scanItemState, setScanItemState] = useState({}); // key: `${resultId}-${itemIdx}`, val: 'saving'|'saved'|'skipped'
  const [scanImageViewer, setScanImageViewer] = useState(null);
  const [expandedAiSummary, setExpandedAiSummary] = useState(null);
  const [pendingScanCue, setPendingScanCue] = useState({ count: 0, visible: false });

  // Composer (input bar) UI state
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  // อุปกรณ์ที่ถ่ายรูปได้จริง (มือถือ/แท็บเล็ต) — ไม่อิงความกว้างจอ
  const [canCapture, setCanCapture] = useState(false);
  const attachMenuRef = useRef(null);
  const inputTextareaRef = useRef(null);

  useEffect(() => {
    return () => {
      scanPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      scanPreviewUrlsRef.current = [];
    };
  }, []);

  // ตรวจว่าเป็นอุปกรณ์แบบสัมผัส/มีกล้อง (รองรับ iPadOS ที่ report เป็น desktop ผ่าน maxTouchPoints)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    const touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    setCanCapture(Boolean(coarsePointer || touch));
  }, []);

  // Close the attach (+) menu when clicking outside
  useEffect(() => {
    if (!showAttachMenu) return undefined;
    const handler = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachMenu]);

  // Auto-grow the composer textarea so the composer itself expands instead of scrolling inside.
  useEffect(() => {
    const el = inputTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 48)}px`;
  }, [input]);

  // Paste image files (e.g. screenshot) directly into the composer to scan them
  const handleComposerPaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (files.length === 0) return;
    e.preventDefault();
    if (requireAccountBeforeScanUpload()) handleScanFiles(files);
  };

  const assetAccounts = useMemo(() => getTransactionAccounts(accounts), [accounts]);
  const modeCategories = useMemo(() => categories.filter((c) => c.type === mode), [categories, mode]);
  const selectedAccount = assetAccounts.find((a) => a.id === accountId);
  const selectedToAccount = assetAccounts.find((a) => a.id === toAccountId);
  const selectedGoal = goals.find((g) => g.id === goalId);

  // ปุ่มสรุป AI: เปิดใช้ได้ต่อเมื่อข้อมูลรอบปัจจุบันถึงเกณฑ์ (ค่า null = ยังไม่รู้ผล → ไม่ล็อกไว้ก่อน)
  const weeklyEligible = aiEligibility.weekly?.eligible !== false;
  const monthlyEligible = aiEligibility.monthly?.eligible !== false;
  const weeklyHint = aiEligibility.weekly?.reason || 'ต้องมีรายการรายรับ/รายจ่ายมากกว่า 10 รายการในสัปดาห์นี้ก่อน จึงจะสรุปด้วย AI ได้';
  const monthlyHint = aiEligibility.monthly?.reason || 'ต้องมีรายการรายรับ/รายจ่ายมากกว่า 10 รายการในเดือนนี้ก่อน จึงจะสรุปด้วย AI ได้';

  // Sync back chat log changes to database
  const saveChatLog = useCallback(async (msgs) => {
    if (!chatLoaded) return;
    try {
      const safe = msgs.slice(-80).map((msg) => {
        if (msg.role === 'preview') {
          return {
            id: msg.id,
            role: 'preview',
            readonly: !!msg.readonly,
            mode: msg.mode,
            result: {
              title: msg.result?.title || '',
              amount: Number(msg.result?.amount || 0),
              category_id: msg.result?.category_id || '',
            },
            account: msg.account ? { id: msg.account.id, name: msg.account.name } : null,
            toAccount: msg.toAccount ? { id: msg.toAccount.id, name: msg.toAccount.name } : null,
            goal: msg.goal ? { id: msg.goal.id, name: msg.goal.name } : null,
            category: msg.category ? { id: msg.category.id, name: msg.category.name } : null,
          };
        }
        if (msg.role === 'ai_summary') {
          return {
            id: msg.id,
            role: 'ai_summary',
            period: msg.period,
            period_start: msg.period_start,
            period_end: msg.period_end,
            source_notification_id: msg.source_notification_id,
            auto: !!msg.auto,
            summary: msg.summary,
          };
        }
        if (msg.role === 'scan_job') {
          return {
            id: msg.id,
            role: 'scan_job',
            job_id: msg.job_id,
            status: msg.status || 'pending',
            total_count: Number(msg.total_count || 0),
            done_count: Number(msg.done_count || 0),
            ready_count: Number(msg.ready_count || 0),
            rejected_count: Number(msg.rejected_count || 0),
            saved_count: Number(msg.saved_count || 0),
            skipped_count: Number(msg.skipped_count || 0),
            error_count: Number(msg.error_count || 0),
            duplicate_count: Number(msg.duplicate_count || 0),
            receipt_count: Number(msg.receipt_count || 0),
            slip_count: Number(msg.slip_count || 0),
            error_msg: msg.error_msg || '',
          };
        }
        if (msg.role === 'user_images') {
          return {
            id: msg.id,
            role: 'user_images',
            text: msg.text || '',
            job_id: msg.job_id || '',
            upload_status: msg.upload_status || '',
            images: (msg.images || [])
              .filter((image) => image.image_path || (image.url && !String(image.url).startsWith('blob:')))
              .map((image) => ({
                id: image.id || messageId(),
                name: image.name || '',
                image_path: image.image_path || '',
                url: image.url || '',
                status: image.status || '',
                document_type: image.document_type || '',
              })),
          };
        }
        if (msg.role === 'scan_result') {
          return {
            id: msg.id,
            role: 'scan_result',
            job_id: msg.job_id || '',
            result_id: msg.result_id || '',
            image_index: msg.image_index ?? 0,
            status: msg.status || 'uploading',
            image_path: msg.image_path || '',
            name: msg.name || '',
            filename: msg.filename || '',
            document_type: msg.document_type || '',
            error_msg: msg.error_msg || '',
            is_duplicate: !!msg.is_duplicate,
            slip: msg.slip || null,
            data: msg.data || null,
          };
        }
        return {
          id: msg.id,
          role: msg.role,
          text: msg.text || '',
          success: !!msg.success,
        };
      });
      await quickEntry.saveChatLog('chat', safe);
    } catch {}
  }, [chatLoaded]);

  // Fetch helper lists
  const fetchAuxData = useCallback(async () => {
    try {
      const [goalsList, budgetsList, notiList, eligibility] = await Promise.all([
        savingsGoals.list().catch(() => []),
        budgetsApi.list().catch(() => []),
        notiApi.list().catch(() => []),
        aiSummaryApi.eligibility().catch(() => null),
      ]);
      setGoals((goalsList || []).filter((g) => g.status === 'in_progress'));
      setBudgets(budgetsList || []);
      setNotifications(notiList || []);
      if (eligibility) {
        setAiEligibility({ weekly: eligibility.weekly || null, monthly: eligibility.monthly || null });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchAuxData();
  }, [fetchAuxData]);

  // Load chat log history (syncs with bottom-right floating chat) and merge initial notifications
  useEffect(() => {
    let cancelled = false;
    setChatLoaded(false);

    const initChat = async () => {
      try {
        const [chatData, notiList] = await Promise.all([
          quickEntry.getChatLog('chat').catch(() => null),
          notiApi.list().catch(() => [])
        ]);
        if (cancelled) return;
        
        const storedMessages = (Array.isArray(chatData?.messages) ? chatData.messages : [])
          .filter((m) => !(m.role === 'notification' && isChatHiddenNoti(m.notification_type)));
        let merged = storedMessages.length > 0 ? [...storedMessages] : [firstBotMessage('chat')];
        
        if (Array.isArray(notiList)) {
          notiList.forEach((noti) => {
            if (isChatHiddenNoti(noti.notification_type)) return;
            const exists = merged.some((m) => m.id === noti.id || m.notification_id === noti.id);
            if (!exists) {
              merged.push({
                id: noti.id,
                notification_id: noti.id,
                role: 'notification',
                notification_type: noti.notification_type,
                title: noti.title,
                text: noti.message,
                created_at: noti.created_at,
                action_taken: noti.action_taken,
                originalNoti: noti,
              });
            }
          });
        }
        
        setMessages(merged);
        setChatLoaded(true);
        // Persist initial merged list
        await quickEntry.saveChatLog('chat', merged.slice(-80));
      } catch {
        if (!cancelled) {
          setMessages([firstBotMessage('chat')]);
          setChatLoaded(true);
        }
      }
    };

    initChat();
    return () => { cancelled = true; };
  }, []);

  // Append new notifications to chat log when they arrive, and keep action_taken
  // in sync (e.g. when a recurring item is confirmed/skipped from the navbar panel).
  useEffect(() => {
    if (!chatLoaded) return;

    // Merge the locally-fetched list with the shared list from the navbar panel,
    // preferring whichever copy has already been acted on.
    const byId = new Map();
    [...notifications, ...sharedNotifications].forEach((noti) => {
      if (!noti?.id || isChatHiddenNoti(noti.notification_type)) return;
      const existing = byId.get(noti.id);
      if (!existing || (noti.action_taken && !existing.action_taken)) {
        byId.set(noti.id, noti);
      }
    });
    const merged = Array.from(byId.values());
    if (merged.length === 0) return;

    setMessages((prev) => {
      let updated = [...prev];
      let changed = false;

      merged.forEach((noti) => {
        const idx = updated.findIndex((m) => m.id === noti.id || m.notification_id === noti.id);
        if (idx === -1) {
          updated.push({
            id: noti.id,
            notification_id: noti.id,
            role: 'notification',
            notification_type: noti.notification_type,
            title: noti.title,
            text: noti.message,
            created_at: noti.created_at,
            action_taken: noti.action_taken,
            originalNoti: noti,
          });
          changed = true;
        } else if (noti.action_taken && !updated[idx].action_taken) {
          // Already shown in chat but resolved elsewhere (e.g. from the panel) — sync it.
          updated[idx] = { ...updated[idx], action_taken: true, originalNoti: noti };
          changed = true;
        }
      });

      if (changed) saveChatLog(updated);
      return changed ? updated : prev;
    });
  }, [notifications, sharedNotifications, chatLoaded, saveChatLog]);

  // When an AI summary notification arrives, fetch the completed-period summary and show it in chat.
  useEffect(() => {
    if (!chatLoaded) return;
    const targets = messages.filter((msg) => (
      msg.role === 'notification' &&
      aiNotificationPeriod(msg.notification_type) &&
      !messages.some((m) => m.role === 'ai_summary' && m.source_notification_id === (msg.notification_id || msg.id))
    ));

    targets.forEach((msg) => {
      const notificationId = msg.notification_id || msg.id;
      if (!notificationId || aiSummaryNotificationFetchRef.current.has(notificationId)) return;
      aiSummaryNotificationFetchRef.current.add(notificationId);
      const period = aiNotificationPeriod(msg.notification_type);

      aiSummaryApi.get(period)
        .then((detail) => {
          if (!detail?.summary) return;
          setMessages((prev) => {
            if (prev.some((m) => m.role === 'ai_summary' && m.source_notification_id === notificationId)) return prev;
            const next = [
              ...prev,
              {
                id: `ai-summary-${notificationId}`,
                role: 'ai_summary',
                period,
                period_start: detail.period_start,
                period_end: detail.period_end,
                source_notification_id: notificationId,
                auto: true,
                summary: detail.summary,
              },
            ];
            saveChatLog(next);
            return next;
          });
        })
        .catch(() => {});
    });
  }, [messages, chatLoaded, saveChatLog]);

  // Scroll to bottom only when new messages are added (not on status-update polls)
  useEffect(() => {
    const count = messages.length;
    if (count > prevMsgCountRef.current) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevMsgCountRef.current = count;
  }, [messages.length]);

  useEffect(() => {
    if (parsing || aiLoading) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [parsing, aiLoading]);

  const addMessage = (message) => {
    setMessages((prev) => {
      const next = [...prev, { id: messageId(), ...message }];
      saveChatLog(next);
      return next;
    });
  };

  const requireAccountBeforeScanUpload = () => {
    if (assetAccounts.length > 0) return true;
    addMessage({
      role: 'bot',
      text: 'ต้องสร้างบัญชีก่อน ถึงจะอัปโหลดรูปเพื่อสแกนใบเสร็จหรือสลิปได้ครับ',
      actions: onGoAccounts ? [
        {
          label: 'ไปที่หน้าจัดการบัญชี',
          onClick: onGoAccounts
        }
      ] : undefined
    });
    return false;
  };

  const addChoiceMessage = (message) => {
    setMessages((prev) => {
      const next = [
        ...closeChoiceMessages(prev),
        { id: messageId(), role: 'bot', choiceActive: true, ...message },
      ];
      saveChatLog(next);
      return next;
    });
  };

  const closeActiveChoices = (targetId = null) => {
    setMessages((prev) => {
      const next = closeChoiceMessages(prev, targetId);
      saveChatLog(next);
      return next;
    });
  };

  const refreshPendingScanCue = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const pendingNodes = Array.from(container.querySelectorAll('[data-scan-pending="true"]'));
    const count = pendingNodes.length;
    if (count === 0) {
      setPendingScanCue((prev) => (
        prev.count === 0 && !prev.visible ? prev : { count: 0, visible: false }
      ));
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceFromBottom < 96;
    const containerRect = container.getBoundingClientRect();
    const pendingVisible = pendingNodes.some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > containerRect.top + 12 && rect.top < containerRect.bottom - 12;
    });
    const visible = nearBottom && !pendingVisible;

    setPendingScanCue((prev) => (
      prev.count === count && prev.visible === visible ? prev : { count, visible }
    ));
  }, []);

  const scrollToFirstPendingScanResult = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = container.querySelector('[data-scan-pending="true"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('ring-2', 'ring-amber-300', 'ring-offset-2');
    window.setTimeout(() => {
      target.classList.remove('ring-2', 'ring-amber-300', 'ring-offset-2');
      refreshPendingScanCue();
    }, 1400);
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;

    const onScroll = () => refreshPendingScanCue();
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const timer = window.setTimeout(onScroll, 80);
    return () => {
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.clearTimeout(timer);
    };
  }, [refreshPendingScanCue]);

  useEffect(() => {
    const timer = window.setTimeout(refreshPendingScanCue, 80);
    return () => window.clearTimeout(timer);
  }, [messages, scanItemState, refreshPendingScanCue]);

  const summarizeScanJob = useCallback((job) => {
    const results = job?.results || [];
    return {
      status: job?.status || 'pending',
      total_count: Number(job?.total_count || 0),
      done_count: Number(job?.done_count || 0),
      ready_count: results.filter((r) => r.status === 'done').length,
      rejected_count: results.filter((r) => r.status === 'rejected').length,
      saved_count: results.filter((r) => r.status === 'saved').length,
      skipped_count: results.filter((r) => r.status === 'skipped').length,
      error_count: results.filter((r) => r.status === 'error').length,
      duplicate_count: results.filter((r) => r.document_type === 'slip' && r.is_duplicate).length,
      receipt_count: results.filter((r) => r.document_type === 'receipt').length,
      slip_count: results.filter((r) => r.document_type === 'slip').length,
      error_msg: job?.error_msg || '',
    };
  }, []);

  const upsertScanJobMessage = useCallback((job) => {
    if (!job?.id) return;
    const summary = summarizeScanJob(job);
    const jobResults = job.results || [];
    const allResultsHandled = jobResults.length > 0
      && jobResults.every((result) => ['saved', 'skipped', 'cancelled'].includes(result.status));
    setScanJobDetails((prev) => ({ ...prev, [job.id]: job }));
    setMessages((prev) => {
      let changed = false;
      const jobIdx = prev.findIndex((m) => m.role === 'scan_job' && m.job_id === job.id);
      const jobMsg = {
        id: jobIdx >= 0 ? prev[jobIdx].id : messageId(),
        role: 'scan_job',
        job_id: job.id,
        ...summary,
      };

      let next = prev.map((msg) => {
        // Update scan_job progress message
        if (msg.role === 'scan_job' && msg.job_id === job.id) {
          changed = true;
          if (allResultsHandled) return null;
          return { ...msg, ...jobMsg };
        }
        // Update individual scan_result bubbles
        if (msg.role === 'scan_result' && msg.job_id === job.id) {
          const result = (job.results || []).find((r) => r.id === msg.result_id)
            || (job.results || [])[msg.image_index];
          if (!result) return msg;
          const newStatus = result.status === 'pending' ? 'scanning' : result.status;
          if (
            msg.status === newStatus
            && msg.result_id === result.id
            && msg.image_path === (result.image_path || '')
            && !!msg.is_duplicate === !!result.is_duplicate
          ) return msg;
          changed = true;
          return {
            ...msg,
            result_id: result.id || msg.result_id,
            status: newStatus,
            image_path: result.image_path || msg.image_path,
            document_type: result.document_type || msg.document_type,
            filename: result.filename || msg.filename,
            error_msg: result.error_msg || '',
            is_duplicate: !!result.is_duplicate,
            slip: result.slip !== undefined ? result.slip : msg.slip,
            data: result.data !== undefined ? result.data : msg.data,
          };
        }
        return msg;
      }).filter(Boolean);

      // Add scan_job message if not present (e.g. old chat loaded from DB)
      if (jobIdx < 0 && !allResultsHandled) {
        changed = true;
        next = [...next, jobMsg];
      }

      if (!changed) return prev;
      saveChatLog(next);
      return next;
    });
  }, [saveChatLog, summarizeScanJob]);

  const getDefaultCategoryId = useCallback((type = 'expense') => {
    return categories.find((cat) => cat.type === type)?.id || '';
  }, [categories]);

  const getReceiptTotal = (data) => {
    return (data?.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  };

  const buildScanReviewValue = useCallback((result) => {
    const isSlip = result.document_type === 'slip';
    const slip = result.slip || {};
    const receipt = result.data || {};
    const amount = isSlip ? Number(slip.amount || 0) : getReceiptTotal(receipt);
    const txType = 'expense';
    const categoryType = 'expense';
    const name = isSlip
      ? (slip.receiver || slip.sender || 'สลิปโอนเงิน')
      : (receipt.merchant || 'ใบเสร็จ');
    // Receipt-only: items + VAT/discount from scan data
    const defaultCatId = getDefaultCategoryId('expense');
    const items = !isSlip
      ? (receipt.items || []).filter((it) => (it.amount || 0) > 0).map((it) => ({
          name: it.name || '',
          amount: Number(it.amount) || 0,
          note: it.note || '',
          category_id: defaultCatId,
        }))
      : [];
    const vatAmount = !isSlip && receipt.vat?.amount > 0 ? String(receipt.vat.amount) : '';
    const vatMode = !isSlip && receipt.vat?.mode === 'exclude' ? 'exclude' : 'include';
    const discountAmount = !isSlip && receipt.discount?.amount > 0 ? String(receipt.discount.amount) : '';
    const discountMode = !isSlip && receipt.discount?.mode === 'ignore' ? 'ignore' : 'prorate';
    return {
      tx_type: txType,
      account_id: assetAccounts[0]?.id || '',
      category_id: getDefaultCategoryId(categoryType),
      name,
      amount: amount > 0 ? amount.toFixed(2) : '',
      transaction_date: (isSlip ? slip.date : receipt.date) || todayStr(),
      items,
      vatAmount,
      vatMode,
      discountAmount,
      discountMode,
    };
  }, [assetAccounts, getDefaultCategoryId]);

  const getReceiptReviewAdjustments = (review) => {
    if (!review) return { vat: 0, discount: 0 };
    return {
      vat: review.vatMode === 'exclude' ? Math.max(0, Number(review.vatAmount) || 0) : 0,
      discount: review.discountMode === 'prorate' ? Math.max(0, Number(review.discountAmount) || 0) : 0,
    };
  };

  const getReceiptReviewFinalItems = (review) => {
    const items = (review?.items || []).filter((it) => it.is_manual || (it.amount || 0) > 0);
    const baseTotal = items.reduce((sum, it) => sum + Number(it.amount || 0), 0);
    const { vat, discount } = getReceiptReviewAdjustments(review);
    return items.map((it) => {
      const amount = Number(it.amount || 0);
      const ratio = baseTotal > 0 ? amount / baseTotal : 0;
      const finalAmount = Math.max(0, amount + vat * ratio - discount * ratio);
      return { ...it, amount, finalAmount: Number(finalAmount.toFixed(2)) };
    });
  };

  const ensureScanReview = useCallback((job) => {
    const results = job?.results || [];
    if (results.length === 0) return;
    setScanReview((prev) => {
      let changed = false;
      const next = { ...prev };
      results.forEach((result) => {
        if (result.status === 'done' && !next[result.id]) {
          next[result.id] = buildScanReviewValue(result);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [buildScanReviewValue]);

  const handleScanFiles = async (fileList) => {
    if (!requireAccountBeforeScanUpload()) return;
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0 || scanUploading) return;
    if (files.length > 20) {
      addMessage({ role: 'bot', text: 'อัปโหลดได้สูงสุด 20 รูปต่อหนึ่งงานสแกนครับ ถ้ามีมากกว่านี้ให้แบ่งอัปโหลดเป็นงานใหม่ได้เรื่อย ๆ' });
      return;
    }
    const imageFiles = files.filter((file) => {
      const name = (file.name || '').toLowerCase();
      return file.type.startsWith('image/') || name.endsWith('.heic') || name.endsWith('.heif');
    });
    if (imageFiles.length === 0) {
      addMessage({ role: 'bot', text: 'รองรับเฉพาะรูปภาพ JPG, PNG, HEIC หรือ HEIF ครับ' });
      return;
    }
    closeActiveChoices();
    setScanUploading(true);
    let uploadFiles = imageFiles;
    try {
      const converted = await convertHeicFilesToJpeg(imageFiles);
      uploadFiles = converted.files;
      if (converted.convertedCount > 0) {
        addMessage({ role: 'bot', text: `แปลงรูป HEIC เป็น JPEG แล้ว ${converted.convertedCount} รูปครับ` });
      }
    } catch (err) {
      setScanUploading(false);
      addMessage({ role: 'bot', text: err.message || 'แปลงรูป HEIC ไม่สำเร็จ กรุณาแปลงเป็น JPG/PNG ก่อนอัปโหลดครับ' });
      return;
    }
    const userImageMessageId = messageId();
    const localImages = uploadFiles.map((file) => {
      const name = file.name || 'image';
      const lowerName = name.toLowerCase();
      const canPreview = !lowerName.endsWith('.heic') && !lowerName.endsWith('.heif');
      let previewUrl = '';
      if (canPreview) {
        previewUrl = URL.createObjectURL(file);
        scanPreviewUrlsRef.current.push(previewUrl);
      }
      return {
        id: messageId(),
        name,
        preview_url: previewUrl,
        is_local: true,
      };
    });
    // Generate stable IDs for individual scan_result bubbles
    const scanResultMsgIds = localImages.map(() => messageId());

    setMessages((prev) => {
      const next = [
        ...prev,
        {
          id: userImageMessageId,
          role: 'user_images',
          text: `ส่งรูป ${uploadFiles.length} รูป`,
          upload_status: 'uploading',
          images: localImages,
        },
        // One spinner bubble per image, shown immediately
        ...localImages.map((img, idx) => ({
          id: scanResultMsgIds[idx],
          role: 'scan_result',
          job_id: null,
          result_id: null,
          image_index: idx,
          status: 'uploading',
          preview_url: img.preview_url,
          name: img.name,
          filename: img.name,
          image_path: '',
          document_type: '',
          error_msg: '',
          is_duplicate: false,
          slip: null,
          data: null,
        })),
      ];
      saveChatLog(next);
      return next;
    });
    try {
      const res = await scanJobsApi.create(uploadFiles);
      const job = await scanJobsApi.get(res.job_id);
      const serverImages = (job.results || []).map((result, index) => ({
        id: result.id || localImages[index]?.id || messageId(),
        name: result.filename || localImages[index]?.name || `รูปที่ ${index + 1}`,
        image_path: result.image_path || '',
        status: result.status || '',
        document_type: result.document_type || '',
      }));
      // Update user_images + all scan_result bubbles with server data
      setMessages((prev) => {
        const next = prev.map((msg) => {
          if (msg.id === userImageMessageId) {
            return {
              ...msg,
              text: `ส่งรูป ${serverImages.length || uploadFiles.length} รูป`,
              job_id: job.id,
              upload_status: 'done',
              images: serverImages.length > 0 ? serverImages : msg.images,
            };
          }
          if (msg.role === 'scan_result' && scanResultMsgIds.includes(msg.id)) {
            const idx = scanResultMsgIds.indexOf(msg.id);
            const result = (job.results || [])[idx];
            if (!result) return { ...msg, job_id: job.id, status: 'scanning' };
            return {
              ...msg,
              job_id: job.id,
              result_id: result.id,
              status: result.status === 'pending' ? 'scanning' : result.status,
              image_path: result.image_path || '',
              document_type: result.document_type || '',
              filename: result.filename || msg.name,
              is_duplicate: !!result.is_duplicate,
              slip: result.slip || null,
              data: result.data || null,
            };
          }
          return msg;
        });
        saveChatLog(next);
        return next;
      });
      upsertScanJobMessage(job);
    } catch (err) {
      setMessages((prev) => {
        const next = prev.map((msg) => {
          if (msg.id === userImageMessageId) return { ...msg, upload_status: 'error' };
          if (msg.role === 'scan_result' && scanResultMsgIds.includes(msg.id)) return { ...msg, status: 'error', error_msg: err.message || 'อัปโหลดไม่สำเร็จ' };
          return msg;
        });
        saveChatLog(next);
        return next;
      });
      addMessage({ role: 'bot', text: err.message || 'อัปโหลดเอกสารไม่สำเร็จครับ' });
    } finally {
      setScanUploading(false);
    }
  };

  useEffect(() => {
    if (!chatLoaded) return undefined;
    const activeJobIds = [...new Set(messages
      .filter((m) => m.role === 'scan_job' && ['pending', 'processing'].includes(m.status))
      .map((m) => m.job_id)
      .filter(Boolean))];
    if (activeJobIds.length === 0) return undefined;

    let cancelled = false;
    const refreshScanJobs = async () => {
      for (const jobId of activeJobIds) {
        try {
          const job = await scanJobsApi.get(jobId);
          if (!cancelled) upsertScanJobMessage(job);
        } catch {}
      }
    };
    refreshScanJobs();
    const timer = setInterval(refreshScanJobs, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chatLoaded, messages, upsertScanJobMessage]);

  useEffect(() => {
    if (!chatLoaded) return;
    const jobIds = [...new Set(messages
      .filter((m) => m.role === 'scan_job')
      .map((m) => m.job_id)
      .filter(Boolean))];
    jobIds.forEach(async (jobId) => {
      if (scanJobDetails[jobId]) {
        ensureScanReview(scanJobDetails[jobId]);
        return;
      }
      try {
        const job = await scanJobsApi.get(jobId);
        setScanJobDetails((prev) => ({ ...prev, [jobId]: job }));
        ensureScanReview(job);
      } catch {}
    });
  }, [chatLoaded, messages, scanJobDetails, ensureScanReview]);

  useEffect(() => {
    if (!chatLoaded) return;
    const doneResults = messages.filter((m) =>
      m.role === 'scan_result' &&
      m.result_id &&
      m.status === 'done' &&
      !scanReview[m.result_id]
    );
    if (doneResults.length === 0) return;
    setScanReview((prev) => {
      let changed = false;
      const next = { ...prev };
      doneResults.forEach((msg) => {
        if (next[msg.result_id]) return;
        next[msg.result_id] = buildScanReviewValue({
          document_type: msg.document_type,
          slip: msg.slip,
          data: msg.data,
        });
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [chatLoaded, messages, scanReview, buildScanReviewValue]);

  const changeMode = (nextMode) => {
    if (nextMode === mode) return;
    closeActiveChoices();
    setMode(nextMode);
    setInput('');
    setAccountId('');
    setToAccountId('');
    setGoalId('');
    setCategoryId('');
    setPendingText('');
    setParsed(null);
  };

  const clearChatLog = () => {
    setAccountId('');
    setToAccountId('');
    setGoalId('');
    setCategoryId('');
    setPendingText('');
    setParsed(null);
    setMessages([firstBotMessage('chat')]);
    quickEntry.clearChatLog('chat').catch(() => {});
  };

  // Ask for confirmation inputs
  const askAccount = (textToContinue, list = assetAccounts, context = {}) => {
    setPendingText(textToContinue);
    addChoiceMessage({
      choiceType: 'account',
      text: mode === 'saving'
        ? 'เลือกบัญชีที่ต้องการถอนเงินออม:'
        : mode === 'transfer'
          ? 'เลือกบัญชีต้นทางที่จะโอนเงินออก:'
          : 'เลือกบัญชีที่จะใช้จ่าย/รับเงิน:',
      actions: list.map((account) => ({
        label: `${account.name} (฿${fmt(account.balance)})`,
        onClick: () => selectAccount(account.id, textToContinue, context),
      })),
    });
  };

  const askTransferDestination = (textToContinue, fromAccountId = accountId, context = {}) => {
    const fromAccount = assetAccounts.find((a) => a.id === fromAccountId);
    const destinationAccounts = assetAccounts.filter((a) => a.id !== fromAccountId);
    if (destinationAccounts.length === 0) {
      addMessage({ role: 'bot', text: 'ต้องมีอย่างน้อย 2 บัญชี ถึงจะบันทึกการโอนได้ครับ' });
      return;
    }
    setPendingText(textToContinue);
    addChoiceMessage({
      choiceType: 'to_account',
      text: `เลือกบัญชีปลายทางที่จะรับเงินจาก "${fromAccount?.name || 'บัญชีต้นทาง'}":`,
      actions: destinationAccounts.map((account) => ({
        label: `${account.name} (฿${fmt(account.balance)})`,
        onClick: () => selectTransferDestination(account.id, textToContinue, { ...context, accountId: fromAccountId }),
      })),
    });
  };

  const askAccountForPreview = (result) => {
    if (mode === 'transfer') {
      addChoiceMessage({
        choiceType: 'account',
        text: 'เลือกบัญชีต้นทางใหม่:',
        actions: assetAccounts.map((account) => ({
          label: `${account.name} (฿${fmt(account.balance)})`,
          onClick: () => {
            if (result.amount > account.balance) {
              addMessage({
                role: 'bot',
                text: `ยอดเงินในบัญชี "${account.name}" ไม่เพียงพอครับ (ยอดคงเหลือ ฿${fmt(account.balance)}) ไม่สามารถโอน ฿${fmt(result.amount)} ได้`
              });
              return false;
            }
            setAccountId(account.id);
            setToAccountId('');
            addMessage({ role: 'user', text: account.name });
            askTransferDestination(pendingText, account.id, { result });
            return true;
          },
        })),
      });
      return;
    }
    const list = mode === 'saving' && selectedGoal?.account_id
      ? assetAccounts.filter((a) => a.id !== selectedGoal.account_id)
      : assetAccounts;
    addChoiceMessage({
      choiceType: 'account',
      text: mode === 'saving' ? 'จะออมจากบัญชีไหนดีครับ?' : 'จะบันทึกเงินเข้า/ออกจากบัญชีไหนดี?',
      actions: list.map((account) => ({
        label: `${account.name} (฿${fmt(account.balance)})`,
        onClick: () => {
          if ((mode === 'expense' || mode === 'saving') && result.amount > account.balance) {
            addMessage({
              role: 'bot',
              text: `ยอดเงินในบัญชี "${account.name}" ไม่เพียงพอครับ (ยอดคงเหลือ ฿${fmt(account.balance)}) ไม่สามารถเลือกบัญชีนี้สำหรับยอดเงิน ฿${fmt(result.amount)} ได้ กรุณาเลือกบัญชีอื่นหรือพิมพ์รายการใหม่ครับ`
            });
            return false;
          }
          setAccountId(account.id);
          addMessage({ role: 'user', text: account.name });
          showPreview(result, categoryId, { accountId: account.id, goalId });
          return true;
        },
      })),
    });
  };

  const askGoal = (textToContinue, context = {}) => {
    setPendingText(textToContinue);
    addChoiceMessage({
      choiceType: 'goal',
      text: 'เลือกเป้าหมายการออมที่ต้องการเก็บเงินเข้า:',
      actions: goals.map((goal) => ({
        label: goal.name,
        onClick: () => selectGoal(goal.id, textToContinue, context),
      })),
    });
  };

  const askCategory = (result, context = {}) => {
    addChoiceMessage({
      choiceType: 'category',
      text: 'กรุณาเลือกหมวดหมู่ให้รายการนี้ด้วยครับ:',
      actions: modeCategories.map((cat) => ({
        label: cat.name,
        onClick: () => {
          setCategoryId(cat.id);
          showPreview(result, cat.id, context);
        },
      })),
    });
  };

  const selectAccount = (id, textToContinue = pendingText, context = {}) => {
    setAccountId(id);
    const account = assetAccounts.find((a) => a.id === id);
    addMessage({ role: 'user', text: account?.name || 'เลือกบัญชีแล้ว' });
    if (mode === 'transfer') {
      setToAccountId('');
      askTransferDestination(textToContinue, id, context);
      return;
    }
    const effectiveGoalId = context.goalId || goalId;
    if (mode === 'saving' && !effectiveGoalId) {
      askGoal(textToContinue, { accountId: id });
      return;
    }
    parseText(textToContinue, { accountId: id, goalId: effectiveGoalId });
  };

  const selectTransferDestination = (id, textToContinue = pendingText, context = {}) => {
    const fromAccountId = context.accountId || accountId;
    if (!fromAccountId) {
      askAccount(textToContinue);
      return;
    }
    if (id === fromAccountId) {
      addMessage({ role: 'bot', text: 'บัญชีต้นทางและบัญชีปลายทางต้องไม่ใช่บัญชีเดียวกันครับ' });
      askTransferDestination(textToContinue, fromAccountId, context);
      return;
    }
    setToAccountId(id);
    const account = assetAccounts.find((a) => a.id === id);
    addMessage({ role: 'user', text: account?.name || 'เลือกบัญชีปลายทางแล้ว' });
    if (context.result) {
      showPreview(context.result, categoryId, { accountId: fromAccountId, toAccountId: id });
      return;
    }
    parseText(textToContinue, { accountId: fromAccountId, toAccountId: id });
  };

  const selectGoal = (id, textToContinue = pendingText, context = {}) => {
    setGoalId(id);
    const goal = goals.find((g) => g.id === id);
    addMessage({ role: 'user', text: goal?.name || 'เลือกเป้าหมายแล้ว' });
    const availableAccounts = assetAccounts.filter((a) => a.id !== goal?.account_id);
    const effectiveAccountId = context.accountId || accountId;
    if (!effectiveAccountId) {
      if (availableAccounts.length === 1) {
        setAccountId(availableAccounts[0].id);
        parseText(textToContinue, { goalId: id, accountId: availableAccounts[0].id });
      } else {
        askAccount(textToContinue, availableAccounts, { goalId: id });
      }
      return;
    }
    parseText(textToContinue, { goalId: id, accountId: effectiveAccountId });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || parsing || saving || !chatLoaded) return;
    setInput('');
    closeActiveChoices();

    // Handle slash or text commands for summaries
    if (text === 'สรุปรายสัปดาห์' || text === 'สรุปการเงินรายสัปดาห์') {
      handleGenerateSummaryInline('weekly');
      return;
    }
    if (text === 'สรุปรายเดือน' || text === 'สรุปการเงินรายเดือน') {
      handleGenerateSummaryInline('monthly');
      return;
    }
    if (text === 'วิธีจดบันทึก' || text === 'คู่มือ') {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      addMessage({ role: 'user', text });
      addMessage({ role: 'bot', text: 'เลื่อนขึ้นไปที่ด้านบนสุดของห้องแชทเพื่อดูคู่มือและวิธีกรอกข้อมูลได้เลยครับ' });
      return;
    }

    addMessage({ role: 'user', text });

    if ((mode === 'income' || mode === 'expense') && assetAccounts.length === 0) {
      addMessage({
        role: 'bot',
        text: 'ต้องสร้างบัญชีก่อน ถึงจะบันทึกรายรับหรือรายจ่ายได้ครับ',
        actions: onGoAccounts ? [
          {
            label: 'ไปที่หน้าจัดการบัญชี',
            onClick: onGoAccounts
          }
        ] : undefined
      });
      return;
    }
    if (mode === 'transfer' && assetAccounts.length < 2) {
      addMessage({
        role: 'bot',
        text: assetAccounts.length === 0
          ? 'ต้องสร้างบัญชีก่อน ถึงจะบันทึกการโอนได้ครับ'
          : 'ต้องมีอย่างน้อย 2 บัญชี ถึงจะบันทึกการโอนได้ครับ',
        actions: onGoAccounts ? [
          {
            label: 'ไปที่หน้าจัดการบัญชี',
            onClick: onGoAccounts
          }
        ] : undefined
      });
      return;
    }
    if (mode === 'saving' && goals.length === 0) {
      addMessage({
        role: 'bot',
        text: 'ยังไม่มีเป้าหมายการออมเงินในตอนนี้ สร้างเป้าหมายก่อนนะครับ',
        actions: onGoGoals ? [
          {
            label: 'ไปที่หน้าตั้งเป้าหมายออมเงิน',
            onClick: onGoGoals
          }
        ] : undefined
      });
      return;
    }

    // Validate format first — with 5s timeout; if LLM is slow → client-side fallback (no category)
    setParsing(true);
    {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 5000);
      try {
        preValidatedRef.current = await quickEntry.parse({ mode, text }, controller.signal);
        clearTimeout(tid);
      } catch (err) {
        clearTimeout(tid);
        if (err.name === 'AbortError') {
          // LLM ช้าเกิน 5 วิ — ใช้ client-side parse แล้วให้ user เลือกหมวดหมู่เอง
          const fallback = quickParseFallback(mode, text);
          if (!fallback) {
            addMessage({ role: 'bot', text: 'ไม่พบจำนวนเงินในข้อความ ลองพิมพ์ใหม่ครับ' });
            setParsing(false);
            return;
          }
          preValidatedRef.current = fallback;
        } else {
          addMessage({ role: 'bot', text: err.message || 'รูปแบบไม่ถูกต้อง ลองพิมพ์ใหม่ครับ' });
          setParsing(false);
          return;
        }
      }
    }
    setParsing(false);

    if (mode === 'saving' && !goalId) {
      askGoal(text);
      return;
    }
    if (mode === 'expense') {
      askAccount(text, assetAccounts, { forceAccountChoice: true });
      return;
    }
    if (mode === 'transfer' && !accountId) {
      askAccount(text);
      return;
    }
    if (mode === 'transfer' && !toAccountId) {
      askTransferDestination(text, accountId);
      return;
    }
    if (!accountId) {
      const selectableAccounts = mode === 'saving' && selectedGoal?.account_id
        ? assetAccounts.filter((a) => a.id !== selectedGoal.account_id)
        : assetAccounts;
      if (selectableAccounts.length === 1) {
        selectAccount(selectableAccounts[0].id, text);
      } else {
        askAccount(text, selectableAccounts);
      }
      return;
    }

    parseText(text);
  };

  const parseText = async (text, overrides = {}) => {
    if (!text) return;
    setParsing(true);
    try {
      let result;
      if (preValidatedRef.current) {
        result = preValidatedRef.current;
        preValidatedRef.current = null;
      } else {
        result = await quickEntry.parse({ mode, text });
      }
      
      const activeAccId = overrides.accountId || accountId;
      const activeToAccId = overrides.toAccountId || toAccountId;
      const activeAcc = assetAccounts.find((a) => a.id === activeAccId);
      if (activeAcc && (mode === 'expense' || mode === 'saving' || mode === 'transfer') && result.amount > activeAcc.balance) {
        addMessage({
          role: 'bot',
          text: `ยอดเงินในบัญชี "${activeAcc.name}" ไม่เพียงพอครับ (ยอดคงเหลือ ฿${fmt(activeAcc.balance)}) แต่คุณระบุจำนวนเงิน ฿${fmt(result.amount)} กรุณากรอกจำนวนเงินใหม่ให้ถูกต้อง`
        });
        setParsed(null);
        setPendingText('');
        return;
      }
      if (mode === 'transfer') {
        if (!activeAccId) {
          askAccount(text);
          return;
        }
        if (!activeToAccId) {
          askTransferDestination(text, activeAccId);
          return;
        }
        if (activeAccId === activeToAccId) {
          addMessage({ role: 'bot', text: 'บัญชีต้นทางและบัญชีปลายทางต้องไม่ใช่บัญชีเดียวกันครับ' });
          askTransferDestination(text, activeAccId);
          return;
        }
      }

      setParsed(result);
      const nextCategoryId = result.category_id || '';
      setCategoryId(nextCategoryId);
      if (mode !== 'saving' && mode !== 'transfer' && !nextCategoryId) {
        askCategory(result, overrides);
      } else {
        showPreview(result, nextCategoryId, overrides);
      }
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'แยกรายการไม่สำเร็จ ลองพิมพ์ใหม่อีกครั้งนะครับ' });
    } finally {
      setParsing(false);
      setPendingText('');
    }
  };

  const showPreview = (result, nextCategoryId = categoryId, overrides = {}) => {
    setParsed(result);
    setCategoryId(nextCategoryId || '');
    const previewAccountId = overrides.accountId || accountId;
    const previewToAccountId = overrides.toAccountId || toAccountId;
    const previewGoalId = overrides.goalId || goalId;
    const previewAccount = assetAccounts.find((a) => a.id === previewAccountId);
    const previewToAccount = assetAccounts.find((a) => a.id === previewToAccountId);
    const previewGoal = goals.find((g) => g.id === previewGoalId);
    const previewCategory = categories.find((c) => c.id === nextCategoryId);

    addMessage({
      role: 'preview',
      result,
      account: previewAccount,
      toAccount: previewToAccount,
      goal: previewGoal,
      category: previewCategory,
      mode,
    });
  };

  const handleCancelPreview = (msgId, title, amount) => {
    setMessages((prev) => {
      const filtered = closeChoiceMessages(prev).filter((m) => m.id !== msgId);
      const next = [
        ...filtered,
        {
          id: messageId(),
          role: 'bot',
          text: `ยกเลิกการบันทึกรายการ "${title}" จำนวน ฿${fmt(amount)} เรียบร้อยแล้วครับ`,
        }
      ];
      saveChatLog(next);
      return next;
    });
    setParsed(null);
    setPendingText('');
  };

  const handleSave = async () => {
    if (!parsed || saving) return;
    const amount = Number(parsed.amount || 0);
    if (amount <= 0) {
      addMessage({ role: 'bot', text: 'จำนวนเงินต้องมากกว่า 0 บาทครับ' });
      return;
    }

    setSaving(true);
    try {
      if (mode === 'saving') {
        const goal = selectedGoal;
        if (!goal) throw new Error('กรุณาเลือกเป้าหมายการออมก่อน');
        if (!goal.account_id) throw new Error('เป้าหมายนี้ยังไม่ได้สร้างบัญชีเป้าหมายเพื่อเก็บออม');
        if (!accountId) throw new Error('กรุณาเลือกบัญชีที่จะโอนเงินออก');
        if (accountId === goal.account_id) throw new Error('บัญชีต้นทางต้องไม่ใช่บัญชีเป้าหมายเดียวกัน');
        if (selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await savingsGoals.deposit(goal.id, {
          from_account_id: accountId,
          amount,
          note: parsed.title || 'ออมเงินผ่านแชทผู้ช่วย',
          date: todayStr(),
        });
      } else if (mode === 'transfer') {
        if (!accountId) throw new Error('กรุณาเลือกบัญชีต้นทาง');
        if (!toAccountId) throw new Error('กรุณาเลือกบัญชีปลายทาง');
        if (accountId === toAccountId) throw new Error('บัญชีต้นทางและบัญชีปลายทางต้องไม่ใช่บัญชีเดียวกัน');
        if (!selectedToAccount) throw new Error('ไม่พบบัญชีปลายทางที่เลือก');
        if (selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีต้นทางไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await transactions.create({
          type: 'transfer',
          account_id: accountId,
          to_account_id: toAccountId,
          amount,
          name: parsed.title || pendingText || 'โอนเงินผ่านผู้ช่วย',
          transaction_date: todayStr(),
        });
      } else {
        if (!accountId) throw new Error('กรุณาเลือกบัญชี');
        if (!categoryId) throw new Error('กรุณาเลือกหมวดหมู่');
        if (mode === 'expense' && selectedAccount && amount > Number(selectedAccount.balance || 0)) {
          throw new Error(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(selectedAccount.balance || 0)}`);
        }
        await transactions.create({
          type: mode,
          account_id: accountId,
          category_id: categoryId,
          amount,
          name: parsed.title || pendingText || 'บันทึกผ่านผู้ช่วย',
          transaction_date: todayStr(),
        });
      }

      setMessages((prev) => {
        const updated = closeChoiceMessages(prev).map((m) => {
          if (m.role === 'preview' && !m.readonly) {
            return { ...m, readonly: true };
          }
          return m;
        });
        const next = [
          ...updated,
          {
            id: messageId(),
            role: 'bot',
            text: `บันทึก${MODE_META[mode].label} ฿${fmt(amount)} เรียบร้อยแล้วครับ!`,
            success: true,
          }
        ];
        saveChatLog(next);
        return next;
      });
      setParsed(null);
      setPendingText('');
      setToAccountId('');
      
      // Refresh views
      await onRefresh?.();
      await fetchAuxData();
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'บันทึกรายการไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  // AI Summary Handler Inline
  const handleGenerateSummaryInline = async (period) => {
    const periodLabel = period === 'weekly' ? 'สัปดาห์' : 'เดือน';
    
    // Add user query
    const userMsgId = messageId();
    const nextMsgs1 = [
      ...messages,
      { id: userMsgId, role: 'user', text: `กรุณาสรุปการเงินราย${periodLabel}ให้หน่อยครับ` }
    ];
    setMessages(nextMsgs1);
    saveChatLog(nextMsgs1);

    try {
      const profile = await profileApi.get();
      if (!profile?.ai_summary_enabled) {
        const next = [
          ...nextMsgs1,
          {
            id: messageId(),
            role: 'bot',
            text: 'ยังไม่ได้เปิดการยินยอมให้ใช้ข้อมูลกับ AI ครับ ต้องเปิดที่หน้าโปรไฟล์ก่อนถึงจะสร้างสรุปการเงินรายสัปดาห์หรือรายเดือนได้',
            choiceActive: true,
            actions: onGoProfile ? [
              {
                label: 'ไปหน้าโปรไฟล์',
                onClick: onGoProfile,
              },
            ] : undefined,
          },
        ];
        setMessages(next);
        saveChatLog(next);
        return;
      }
    } catch (err) {
      const next = [
        ...nextMsgs1,
        {
          id: messageId(),
          role: 'bot',
          text: 'ตอนนี้ตรวจสอบสถานะการยินยอม AI ไม่สำเร็จครับ ลองเปิดหน้าโปรไฟล์เพื่อตรวจสอบอีกครั้ง',
          choiceActive: true,
          actions: onGoProfile ? [
            {
              label: 'ไปหน้าโปรไฟล์',
              onClick: onGoProfile,
            },
          ] : undefined,
        },
      ];
      setMessages(next);
      saveChatLog(next);
      return;
    }

    // Add bot loading status
    const botLoadingId = messageId();
    const nextMsgs2 = [
      ...nextMsgs1,
      { id: botLoadingId, role: 'bot', text: `กำลังรวบรวมและวิเคราะห์ข้อมูลการเงินราย${periodLabel}ด้วย AI สักครู่ครับ...` }
    ];
    setMessages(nextMsgs2);
    setAiLoading(true);

    try {
      await aiSummaryApi.generate(period);
      const detail = await aiSummaryApi.get(period);
      
      setAiLoading(false);
      if (detail && detail.summary) {
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== botLoadingId);
          const next = [
            ...filtered,
            {
              id: messageId(),
              role: 'ai_summary',
              period,
              period_start: detail.period_start,
              period_end: detail.period_end,
              summary: detail.summary
            }
          ];
          saveChatLog(next);
          return next;
        });
      } else {
        throw new Error('ไม่พบข้อมูลสรุป');
      }
    } catch (err) {
      setAiLoading(false);
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== botLoadingId);
        const next = [
          ...filtered,
          {
            id: messageId(),
            role: 'bot',
            text: getAiSummaryFailureMessage(err)
          }
        ];
        saveChatLog(next);
        return next;
      });
    }
  };

  // Notifications Interactive Inline Trigger
  const handleConfirmNotification = async (noti, notiMsgId) => {
    try {
      await notiApi.confirm(noti.id);
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === notiMsgId || m.notification_id === noti.id
            ? { ...m, action_taken: true, recurringAction: 'confirmed' }
            : m
        );
        saveChatLog(next);
        return next;
      });
      await fetchAuxData();
      await onRefresh?.();
    } catch (err) {
      alert(err.message || 'ไม่สามารถยืนยันรายการทำซ้ำได้');
    }
  };

  const handleSkipNotification = async (noti, notiMsgId) => {
    try {
      await notiApi.skip(noti.id);
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.id === notiMsgId || m.notification_id === noti.id
            ? { ...m, action_taken: true, recurringAction: 'skipped' }
            : m
        );
        saveChatLog(next);
        return next;
      });
      await fetchAuxData();
    } catch (err) {
      alert(err.message || 'ไม่สามารถข้ามรายการได้');
    }
  };

  const handleGuideScroll = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelScanJob = async (jobId) => {
    try {
      await scanJobsApi.cancel(jobId);
      const job = await scanJobsApi.get(jobId).catch(() => null);
      if (job) upsertScanJobMessage(job);
      // Hide scan_result cards still in scanning/uploading state
      setMessages((prev) => prev.map((msg) =>
        msg.role === 'scan_result' && msg.job_id === jobId && ['uploading', 'scanning'].includes(msg.status)
          ? { ...msg, status: 'cancelled' }
          : msg
      ));
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'ยกเลิกงานสแกนไม่สำเร็จครับ' });
    }
  };

  const updateScanReview = (resultId, patch) => {
    setScanReview((prev) => ({
      ...prev,
      [resultId]: {
        ...(prev[resultId] || {}),
        ...(typeof patch === 'function' ? patch(prev[resultId] || {}) : patch),
      },
    }));
  };

  const updateItemInReview = (resultId, itemIdx, patch) => {
    setScanReview((prev) => {
      const review = prev[resultId] || {};
      const items = [...(review.items || [])];
      items[itemIdx] = { ...(items[itemIdx] || {}), ...patch };
      return { ...prev, [resultId]: { ...review, items } };
    });
  };

  const addReceiptItemToReview = (resultId) => {
    setScanReview((prev) => {
      const review = prev[resultId] || {};
      const items = [
        ...(review.items || []),
        {
          name: '',
          amount: '',
          note: '',
          category_id: getDefaultCategoryId('expense'),
          is_manual: true,
        },
      ];
      return { ...prev, [resultId]: { ...review, items } };
    });
    setScanEditMode((prev) => ({ ...prev, [resultId]: true }));
  };

  const refreshScanJob = async (jobId) => {
    const job = await scanJobsApi.get(jobId);
    setScanJobDetails((prev) => ({ ...prev, [jobId]: job }));
    ensureScanReview(job);
    upsertScanJobMessage(job);
    return job;
  };

  const skipScanResult = async (jobId, resultId) => {
    setScanSaving((prev) => ({ ...prev, [resultId]: true }));
    try {
      await scanJobsApi.skip(jobId, resultId);
      await refreshScanJob(jobId);
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'ข้ามรายการสแกนไม่สำเร็จครับ' });
    } finally {
      setScanSaving((prev) => ({ ...prev, [resultId]: false }));
    }
  };

  const saveScanResult = async (jobId, result) => {
    const review = scanReview[result.id] || buildScanReviewValue(result);
    const amount = Number(review.amount || 0);
    const account = assetAccounts.find((a) => a.id === review.account_id);
    if (!account) {
      addMessage({ role: 'bot', text: 'กรุณาเลือกบัญชีที่จะใช้บันทึกรายการนี้ก่อนครับ' });
      return;
    }
    if (!review.category_id) {
      addMessage({ role: 'bot', text: 'กรุณาเลือกหมวดหมู่ของรายการนี้ก่อนครับ' });
      return;
    }
    if (amount <= 0) {
      addMessage({ role: 'bot', text: 'จำนวนเงินต้องมากกว่า 0 บาทครับ' });
      return;
    }
    if ((review.tx_type || 'expense') === 'expense' && amount > Number(account.balance || 0)) {
      addMessage({ role: 'bot', text: `ยอดเงินในบัญชี "${account.name}" ไม่เพียงพอครับ คงเหลือ ฿${fmt(account.balance || 0)}` });
      return;
    }

    setScanSaving((prev) => ({ ...prev, [result.id]: true }));
    try {
      if (result.document_type === 'slip') {
        await scanJobsApi.saveSlip(jobId, result.id, {
          tx_type: review.tx_type || 'expense',
          account_id: review.account_id,
          category_id: review.category_id,
          amount,
          name: review.name || result.slip?.receiver || 'สลิปโอนเงิน',
          transaction_date: review.transaction_date || todayStr(),
          note: '',
          ref_no: result.slip?.ref_no || '',
          image_path: result.image_path || '',
        });
      } else {
        await transactions.create({
          type: 'expense',
          account_id: review.account_id,
          category_id: review.category_id,
          amount,
          name: review.name || result.data?.merchant || 'ใบเสร็จ',
          transaction_date: review.transaction_date || todayStr(),
        });
        await scanJobsApi.save(jobId, result.id);
      }
      await Promise.all([onRefresh?.(), fetchAuxData()]);
      await refreshScanJob(jobId);
      addMessage({ role: 'bot', text: `บันทึกรายการจาก${result.document_type === 'slip' ? 'สลิป' : 'ใบเสร็จ'}จำนวน ฿${fmt(amount)} เรียบร้อยแล้วครับ`, success: true });
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'บันทึกรายการสแกนไม่สำเร็จครับ' });
    } finally {
      setScanSaving((prev) => ({ ...prev, [result.id]: false }));
    }
  };

  const saveReceiptItem = async (jobId, resultId, itemIndex, itemData, review) => {
    const key = `${resultId}-${itemIndex}`;
    const itemAmount = Number(itemData.finalAmount ?? itemData.amount ?? 0);
    if (itemAmount <= 0) {
      addMessage({ role: 'bot', text: 'กรุณากรอกราคาของรายการให้มากกว่า 0 บาทก่อนบันทึกครับ' });
      return;
    }
    if (!(itemData.category_id || review.category_id)) {
      addMessage({ role: 'bot', text: 'กรุณาเลือกหมวดหมู่ของรายการก่อนบันทึกครับ' });
      return;
    }
    setScanItemState((prev) => ({ ...prev, [key]: 'saving' }));
    try {
      await transactions.create({
        type: 'expense',
        account_id: review.account_id,
        category_id: itemData.category_id || review.category_id,
        amount: itemAmount,
        name: itemData.name || `รายการ ${itemIndex + 1}`,
        transaction_date: review.transaction_date || todayStr(),
      });
      // Build new state and check if all items are resolved
      const newItemState = { ...scanItemState, [key]: 'saved' };
      setScanItemState(newItemState);
      const totalItems = getReceiptReviewFinalItems(review).length;
      const allResolved = totalItems > 0 && Array.from({ length: totalItems }, (_, i) => {
        const st = newItemState[`${resultId}-${i}`];
        return st === 'saved' || st === 'skipped';
      }).every(Boolean);
      if (allResolved) {
        await scanJobsApi.skip(jobId, resultId);
      }
      await Promise.all([onRefresh?.(), fetchAuxData(), refreshScanJob(jobId)]);
    } catch (err) {
      setScanItemState((prev) => ({ ...prev, [key]: null }));
      addMessage({ role: 'bot', text: err.message || 'บันทึกรายการไม่สำเร็จครับ' });
    }
  };

  const saveReceiptAll = async (jobId, resultId, review) => {
    const account = assetAccounts.find((a) => String(a.id) === String(review?.account_id));
    if (!account) {
      addMessage({ role: 'bot', text: 'กรุณาเลือกบัญชีที่จะใช้บันทึกรายการนี้ก่อนครับ' });
      return;
    }

    const finalItems = getReceiptReviewFinalItems(review);
    const activeItems = finalItems
      .map((item, itemIdx) => ({ item, itemIdx }))
      .filter(({ itemIdx }) => {
        const itemStatus = scanItemState[`${resultId}-${itemIdx}`];
        return itemStatus !== 'saved' && itemStatus !== 'skipped';
      });

    if (activeItems.length === 0) return;
    if (activeItems.some(({ item }) => !item.category_id)) {
      addMessage({ role: 'bot', text: 'กรุณาเลือกหมวดหมู่ให้ครบก่อนบันทึกทั้งหมดครับ' });
      return;
    }
    if (activeItems.some(({ item }) => Number(item.finalAmount ?? item.amount ?? 0) <= 0)) {
      addMessage({ role: 'bot', text: 'กรุณากรอกราคาของทุกรายการให้มากกว่า 0 บาทก่อนบันทึกทั้งหมดครับ' });
      return;
    }

    const totalAmount = activeItems.reduce((sum, { item }) => sum + Number(item.finalAmount || item.amount || 0), 0);
    if (totalAmount <= 0) {
      addMessage({ role: 'bot', text: 'จำนวนเงินต้องมากกว่า 0 บาทครับ' });
      return;
    }
    if (totalAmount > Number(account.balance || 0)) {
      addMessage({ role: 'bot', text: `ยอดเงินในบัญชี "${account.name}" ไม่เพียงพอครับ คงเหลือ ฿${fmt(account.balance || 0)}` });
      return;
    }

    setScanSaving((prev) => ({ ...prev, [resultId]: true }));
    try {
      for (const { item, itemIdx } of activeItems) {
        await transactions.create({
          type: 'expense',
          account_id: review.account_id,
          category_id: item.category_id,
          amount: item.finalAmount ?? item.amount ?? 0,
          name: item.name || `รายการ ${itemIdx + 1}`,
          transaction_date: review.transaction_date || todayStr(),
        });
      }

      const nextItemState = { ...scanItemState };
      activeItems.forEach(({ itemIdx }) => {
        nextItemState[`${resultId}-${itemIdx}`] = 'saved';
      });
      setScanItemState(nextItemState);
      await scanJobsApi.skip(jobId, resultId);
      await Promise.all([onRefresh?.(), fetchAuxData(), refreshScanJob(jobId)]);
      addMessage({
        role: 'bot',
        text: `บันทึกทั้งหมด ${activeItems.length} รายการ รวม ฿${fmt(totalAmount)} เรียบร้อยแล้วครับ`,
        success: true,
      });
    } catch (err) {
      addMessage({ role: 'bot', text: err.message || 'บันทึกทั้งหมดไม่สำเร็จครับ' });
    } finally {
      setScanSaving((prev) => ({ ...prev, [resultId]: false }));
    }
  };

  const skipReceiptItem = async (jobId, resultId, itemIndex, review) => {
    const key = `${resultId}-${itemIndex}`;
    const newItemState = { ...scanItemState, [key]: 'skipped' };
    setScanItemState(newItemState);
    const totalItems = getReceiptReviewFinalItems(review).length;
    const allResolved = totalItems > 0 && Array.from({ length: totalItems }, (_, i) => {
      const st = newItemState[`${resultId}-${i}`];
      return st === 'saved' || st === 'skipped';
    }).every(Boolean);
    if (allResolved) {
      try {
        await scanJobsApi.skip(jobId, resultId);
        await refreshScanJob(jobId);
      } catch (_) { /* best effort */ }
    }
  };

  // Render chatbot messages
  const renderMsg = (message) => {
    if (message.role === 'user_images') {
      const images = message.images || [];
      const visibleImages = images.slice(0, 4);
      const viewableImages = images
        .map((image, imageIndex) => ({
          src: scanImageSrc(image),
          title: image.name || `รูปที่ ${imageIndex + 1}`,
        }))
        .filter((image) => image.src);
      const moreCount = Math.max(0, images.length - visibleImages.length);
      const isSingle = images.length <= 1;
      const statusText = message.upload_status === 'uploading'
        ? 'กำลังอัปโหลด...'
        : message.upload_status === 'error'
          ? 'อัปโหลดไม่สำเร็จ'
          : message.text;

      return (
        <div key={message.id} className="flex justify-end animate-message-right">
          <div className="max-w-[86%] md:max-w-[70%] space-y-0.5">
            <div className={`rounded-2xl rounded-br-md bg-[#2C6488] p-1 shadow-sm ${
              isSingle ? 'w-fit' : 'w-[238px] sm:w-[280px]'
            }`}>
              <div className={`grid gap-1 overflow-hidden rounded-[14px] ${
                isSingle ? 'grid-cols-1' : 'grid-cols-2'
              }`}>
                {visibleImages.map((image, index) => {
                  const src = scanImageSrc(image);
                  const hasPreview = Boolean(src);
                  const imageTitle = image.name || `รูปที่ ${index + 1}`;
                  const viewerIndex = viewableImages.findIndex((item) => item.src === src && item.title === imageTitle);
                  return (
                    <button
                      type="button"
                      key={image.id || `${message.id}-${index}`}
                      onClick={() => {
                        if (hasPreview) {
                          setScanImageViewer({
                            images: viewableImages,
                            index: viewerIndex >= 0 ? viewerIndex : 0,
                          });
                        }
                      }}
                      disabled={!hasPreview}
                      title={hasPreview ? 'กดเพื่อดูรูปใหญ่' : imageTitle}
                      className={`relative overflow-hidden bg-[#EAF3F7] text-left ${
                        isSingle ? 'w-[190px] sm:w-[240px] h-[190px]' : 'aspect-square'
                      } ${hasPreview ? 'cursor-zoom-in hover:brightness-95 transition' : 'cursor-default'}`}
                    >
                      {hasPreview ? (
                        <img
                          src={src}
                          alt={imageTitle}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#2C6488] bg-[#EAF3F7]">
                          <ImagePlus size={22} />
                          <span className="text-[11px] font-semibold px-2 text-center break-all">
                            {image.name || 'รูปภาพ'}
                          </span>
                        </div>
                      )}
                      {moreCount > 0 && index === visibleImages.length - 1 && (
                        <div className="absolute inset-0 bg-slate-900/55 text-white flex items-center justify-center text-xl font-bold">
                          +{moreCount}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
              {message.upload_status === 'uploading' && (
                <RefreshCw size={11} className="animate-spin text-[#2C6488]" />
              )}
              {message.upload_status === 'error' && (
                <AlertCircle size={11} className="text-red-500" />
              )}
              <span>{statusText}</span>
            </div>
          </div>
        </div>
      );
    }

    if (message.role === 'scan_result') {
      if (message.status === 'cancelled') return null;
      const isScanning = ['uploading', 'scanning'].includes(message.status);
      const isDone = message.status === 'done';
      const isSaved = message.status === 'saved';
      const isSkipped = message.status === 'skipped';
      const isError = ['rejected', 'error'].includes(message.status);
      const resultId = message.result_id;
      const isSlip = message.document_type === 'slip';
      const isReceipt = message.document_type === 'receipt';
      const review = resultId
        ? (scanReview[resultId] || buildScanReviewValue({
            document_type: message.document_type,
            slip: message.slip,
            data: message.data,
            image_path: message.image_path,
          }))
        : null;
      const categoryOptions = review
        ? applySavedCategoryOrder('expense', categories.filter((c) => c.type === 'expense'))
        : [];
      const slipTxType = review?.tx_type || 'expense';
      const slipCategoryOptions = review
        ? applySavedCategoryOrder(slipTxType, categories.filter((c) => c.type === slipTxType))
        : [];
      const isEditing = !!scanEditMode[resultId];
      const isBusy = !!scanSaving[resultId];
      const slip = message.slip || {};
      const receipt = message.data || {};
      const isDuplicateSlip = isSlip && !!message.is_duplicate;
      const docLabel = isScanning
        ? 'กำลังแยกประเภท'
        : isSlip
          ? 'สลิป'
          : isReceipt
            ? 'ใบเสร็จ'
            : message.status === 'rejected'
              ? 'ไม่รองรับ'
              : message.status === 'error'
                ? 'อ่านไม่สำเร็จ'
                : 'เอกสาร';
      const resultObj = {
        id: message.result_id,
        document_type: message.document_type,
        slip: message.slip,
        data: message.data,
        image_path: message.image_path,
        filename: message.filename,
        status: message.status,
        error_msg: message.error_msg,
        is_duplicate: !!message.is_duplicate,
      };

      // Receipt VAT/discount calculation
      const getReceiptFinalItems = () => getReceiptReviewFinalItems(review);

      const compactFieldClass = "rounded-lg border border-[#DCE8EE] bg-white px-2 py-1.5 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2C6488]/20 focus:border-[#2C6488]/50 transition";
      const getCategoryName = (categoryId) => categories.find((c) => c.id === categoryId)?.name || 'ยังไม่เลือกหมวดหมู่';
      const slipCategoryName = getCategoryName(review?.category_id || '');
      const scanAccount = assetAccounts.find((a) => String(a.id) === String(review?.account_id));
      const scanAccountMeta = scanAccount
        ? (SCAN_ACC_KIND_META[scanAccount.kind] || { icon: 'DollarSign', color: '#94a3b8' })
        : null;
      const slipTypeLabel = (review?.tx_type || 'expense') === 'income' ? 'รายรับ' : 'รายจ่าย';

      const statusBadge = isSaved ? (
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 flex items-center gap-1 border border-emerald-100">
          <CheckCircle2 size={10} /> บันทึกแล้ว
        </span>
      ) : isSkipped ? (
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 border border-slate-200">ไม่บันทึก</span>
      ) : isError ? (
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-500 border border-red-100">
          {message.status === 'rejected' ? 'ไม่รองรับ' : 'อ่านไม่สำเร็จ'}
        </span>
      ) : isDuplicateSlip ? (
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100">สลิปซ้ำ</span>
      ) : null;
      const scanResultImage = message.image_path
        ? {
            src: scanImageSrc({ image_path: message.image_path }),
            title: message.filename || docLabel,
          }
        : null;

      const staggerDelay = `${(message.image_index ?? 0) * 140}ms`;
      return (
        <div
          key={message.id}
          data-scan-job-id={message.job_id || ''}
          data-scan-result-id={resultId || ''}
          data-scan-pending={isDone ? 'true' : 'false'}
          className="flex justify-start animate-message-left transition"
          style={{ animationDelay: staggerDelay }}
        >
          <div className="w-[20.5rem] sm:w-[23rem] rounded-2xl bg-white dark:bg-slate-800 border border-[#DCE8EE] dark:border-slate-700/60 shadow-sm">

            {/* ── Header ── */}
            <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-2.5 bg-[#F6FAFC] border-b border-[#EAF3F7] rounded-t-2xl">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ${
                isSlip || isReceipt ? 'bg-white text-[#2C6488] border border-[#DCE8EE]' : 'bg-slate-100 text-slate-500 border border-slate-200'
              }`}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#2C6488]" />
                {docLabel}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {statusBadge}
                {scanResultImage?.src && (
                  <button
                    type="button"
                    onClick={() => setScanImageViewer({ images: [scanResultImage], index: 0 })}
                    title="ดูรูปเอกสาร"
                    className="w-7 h-7 rounded-full bg-white border border-[#DCE8EE] text-[#2C6488] inline-flex items-center justify-center hover:bg-[#EAF3F7] transition-colors"
                  >
                    <Image size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* ── Scanning ── */}
            {isScanning && (
              <div className="flex items-center gap-3 px-3 py-3">
                <div className="w-9 h-9 rounded-2xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                  <RefreshCw size={13} className="animate-spin text-[#2C6488]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-600 truncate">{message.filename || 'กำลังสแกนเอกสาร'}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">กำลังอ่านและแยกประเภทเอกสาร</p>
                </div>
              </div>
            )}

            {/* ── Error ── */}
            {isError && (
              <div className="px-3 py-3 space-y-2">
                <div className="rounded-2xl bg-red-50 border border-red-100 px-3 py-2.5">
                  <p className="text-xs font-semibold text-red-500">
                    {message.status === 'rejected'
                      ? (message.error_msg || 'รูปนี้ไม่ใช่ใบเสร็จหรือสลิปที่รองรับ')
                      : (message.error_msg || 'อ่านข้อมูลจากรูปนี้ไม่สำเร็จ')}
                  </p>
                  <p className="text-[11px] text-red-400 mt-1">
                    ระบบจะไม่สร้างรายการบันทึกจากรูปนี้
                  </p>
                </div>
              </div>
            )}

            {/* ── SLIP ── */}
            {isSlip && (isDone || isSaved || isSkipped) && review && (
              <div className="p-3 space-y-2.5">
                <div className="rounded-2xl bg-[#F6FAFC] border border-[#EAF3F7] px-3 py-2.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-slate-400">ชื่อรายการ</p>
                      {isEditing && isDone ? (
                        <input
                          value={review.name || ''}
                          onChange={(e) => updateScanReview(resultId, { name: e.target.value })}
                          className={`mt-1 w-full ${compactFieldClass}`}
                          placeholder={slip.receiver || slip.sender || 'สลิปโอนเงิน'}
                        />
                      ) : (
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate mt-0.5">
                          {review.name || slip.receiver || 'สลิปโอนเงิน'}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[11px] font-semibold text-slate-400">ยอดเงิน</p>
                      {isEditing && isDone ? (
                        <input
                          value={review.amount || ''}
                          onChange={(e) => updateScanReview(resultId, { amount: e.target.value })}
                          className={`mt-1 w-24 text-right ${compactFieldClass}`}
                          placeholder="0.00" type="number" min="0" step="0.01"
                        />
                      ) : (
                        <p className="text-xl font-bold text-[#2C6488] whitespace-nowrap">฿{fmt(Number(review.amount || 0))}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <div className="min-w-0">
                      {isEditing && isDone ? (
                        <input
                          type="date"
                          value={review.transaction_date || todayStr()}
                          onChange={(e) => updateScanReview(resultId, { transaction_date: e.target.value })}
                          className={`w-32 ${compactFieldClass}`}
                        />
                      ) : (
                        <span>{fmtDate(review.transaction_date)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="inline-flex rounded-full bg-white border border-[#DCE8EE] px-2 py-0.5 text-[10px] font-bold text-[#2C6488]">
                        {slipTypeLabel}
                      </span>
                      {isDuplicateSlip && (
                        <span className="inline-flex rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                          สลิปซ้ำ
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="rounded-xl bg-white border border-[#DCE8EE] px-2.5 py-2 min-w-0">
                      <p className="text-[10px] font-semibold text-slate-400">หมวดหมู่</p>
                      {isEditing && isDone ? (
                        <div className="mt-1">
                          <ScanCatSelect
                            value={review.category_id || ''}
                            onChange={(v) => updateScanReview(resultId, { category_id: v })}
                            categories={slipCategoryOptions}
                            compact
                          />
                        </div>
                      ) : (
                        <p className="mt-0.5 text-xs font-semibold text-[#2C6488] truncate">{slipCategoryName}</p>
                      )}
                    </div>
                    <div className="rounded-xl bg-white border border-[#DCE8EE] px-2.5 py-2 min-w-0">
                      <p className="text-[10px] font-semibold text-slate-400">บัญชี</p>
                      {isEditing && isDone ? (
                        <div className="mt-1">
                          <ScanAccSelect
                            value={review.account_id || ''}
                            onChange={(v) => updateScanReview(resultId, { account_id: v })}
                            accounts={assetAccounts}
                          />
                        </div>
                      ) : (
                        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                          {scanAccountMeta && (
                            <span className="w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0"
                              style={{ background: `${scanAccountMeta.color}22` }}>
                              <Icon name={scanAccountMeta.icon} size={10} color={scanAccountMeta.color} />
                            </span>
                          )}
                          <p className="text-xs font-semibold text-slate-700 truncate">{scanAccount?.name || 'ยังไม่เลือกบัญชี'}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {isEditing && isDone && (
                    <div className="flex gap-1.5 border-t border-[#DCE8EE]/70 pt-2">
                      {['expense', 'income'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            const newCats = categories.filter((c) => c.type === t);
                            const currentCat = categories.find((c) => c.id === review.category_id);
                            const matched = currentCat ? newCats.find((c) => c.name === currentCat.name) : null;
                            updateScanReview(resultId, {
                              tx_type: t,
                              category_id: matched?.id || newCats[0]?.id || '',
                            });
                          }}
                          className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                            (review.tx_type || 'expense') === t
                              ? 'bg-[#2C6488] text-white border-[#2C6488]'
                              : 'bg-white text-slate-500 border-[#DCE8EE] hover:bg-[#EAF3F7]'
                          }`}
                        >
                          {t === 'expense' ? 'รายจ่าย' : 'รายรับ'}
                        </button>
                      ))}
                    </div>
                  )}

                  {slip.sender && (
                    <div className="space-y-1.5 border-t border-[#DCE8EE]/70 pt-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-400 flex-shrink-0">ผู้โอน</span>
                        <span className="font-medium text-slate-600 truncate">{slip.sender}</span>
                      </div>
                    </div>
                  )}
                </div>
                {isDuplicateSlip && isDone && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-700">สลิปนี้อาจเคยบันทึกแล้ว</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      พบเลขอ้างอิงซ้ำในระบบ ตรวจสอบก่อนบันทึกซ้ำอีกครั้ง
                    </p>
                  </div>
                )}
                {isDone && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveScanResult(message.job_id, resultObj)}
                      disabled={isBusy}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white text-xs font-semibold disabled:opacity-60 transition-colors"
                    >
                      <Check size={12} />
                      {isBusy ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                    <button
                      onClick={() => skipScanResult(message.job_id, resultId)}
                      disabled={isBusy}
                      className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-500 text-xs font-semibold border border-slate-200 disabled:opacity-60 transition-colors"
                    >
                      ไม่บันทึก
                    </button>
                    <button
                      onClick={() => setScanEditMode((prev) => ({ ...prev, [resultId]: !prev[resultId] }))}
                      className={`px-3 py-2 rounded-xl text-xs border transition-colors flex items-center justify-center ${
                        isEditing
                          ? 'bg-[#2C6488] hover:bg-[#25536F] text-white border-[#2C6488]'
                          : 'bg-[#EAF3F7] hover:bg-[#DCE8EE] text-[#2C6488] border-[#DCE8EE]'
                      }`}
                    >
                      {isEditing ? <Check size={12} /> : <Edit3 size={12} />}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── RECEIPT ── */}
            {isReceipt && (isDone || isSaved || isSkipped) && review && (() => {
              const finalItems = getReceiptFinalItems();
              const receiptTotal = finalItems.reduce((sum, item) => sum + Number(item.finalAmount || item.amount || 0), 0);
              const allReceiptItemsHandled = finalItems.length > 0 && finalItems.every((_, itemIdx) => {
                const itemStatus = scanItemState[`${resultId}-${itemIdx}`];
                return itemStatus === 'saved' || itemStatus === 'skipped';
              });
              return (
                <div className="p-3 space-y-2.5">
                  {/* Merchant */}
                  <div className="rounded-2xl bg-[#F6FAFC] border border-[#EAF3F7] px-3.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-400">ชื่อร้าน</p>
                        {isEditing && isDone ? (
                          <input
                            value={review.name || ''}
                            onChange={(e) => updateScanReview(resultId, { name: e.target.value })}
                            className={`mt-1 w-full ${compactFieldClass}`}
                            placeholder={receipt.merchant || 'ใบเสร็จ'}
                          />
                        ) : (
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate mt-0.5">
                            {review.name || receipt.merchant || 'ใบเสร็จ'}
                          </p>
                        )}
                      </div>
                      <p className="text-lg font-bold text-[#2C6488] whitespace-nowrap">฿{fmt(receiptTotal)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      {isEditing && isDone ? (
                        <input
                          type="date"
                          value={review.transaction_date || todayStr()}
                          onChange={(e) => updateScanReview(resultId, { transaction_date: e.target.value })}
                          className={`w-32 ${compactFieldClass}`}
                        />
                      ) : (
                        <span>{fmtDate(review.transaction_date)}</span>
                      )}
                      <span>{finalItems.length} รายการ</span>
                    </div>
                    {isDone && !allReceiptItemsHandled && (
                      <button
                        type="button"
                        onClick={() => addReceiptItemToReview(resultId)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-[#DCE8EE] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#2C6488] hover:bg-[#EAF3F7] transition-colors"
                      >
                        <Plus size={12} />
                        เพิ่มรายการ
                      </button>
                    )}
                  </div>

                  {/* Items */}
                  {finalItems.length > 0 && (
                    <div className="space-y-1.5">
                      {finalItems.map((item, itemIdx) => {
                        const itemKey = `${resultId}-${itemIdx}`;
                        const itemSt = scanItemState[itemKey];
                        const isSavedItem = itemSt === 'saved';
                        const isSkippedItem = itemSt === 'skipped';
                        const isSavingItem = itemSt === 'saving';
                        const isActiveItem = !isSavedItem && !isSkippedItem;
                        const showArrow = Math.abs(item.finalAmount - item.amount) >= 0.005;
                        const itemCatId = item.category_id || '';
                        return (
                          <div
                            key={itemKey}
                            className={`rounded-2xl border text-xs shadow-sm ${
                              isSavedItem
                                ? 'border-emerald-100 bg-emerald-50/60'
                                : isSkippedItem
                                ? 'border-slate-100 bg-slate-50/60'
                                : 'border-[#DCE8EE] bg-white'
                            }`}
                          >
                            {isEditing && isActiveItem ? (
                              <div className="p-2 space-y-1.5 bg-[#F6FAFC]">
                                <div className="flex gap-1.5">
                                  <input
                                    value={item.name || ''}
                                    onChange={(e) => updateItemInReview(resultId, itemIdx, { name: e.target.value })}
                                    className={`flex-1 min-w-0 ${compactFieldClass}`}
                                    placeholder={`รายการ ${itemIdx + 1}`}
                                  />
                                  <input
                                    value={item.amount || ''}
                                    onChange={(e) => updateItemInReview(resultId, itemIdx, { amount: Number(e.target.value) || 0 })}
                                    type="number" min="0" step="0.01"
                                    className={`w-20 text-right ${compactFieldClass}`}
                                    placeholder="0"
                                  />
                                </div>
                                <div className="flex gap-1.5">
                                  <ScanCatSelect
                                    value={itemCatId}
                                    onChange={(v) => updateItemInReview(resultId, itemIdx, { category_id: v })}
                                    categories={categoryOptions}
                                    compact
                                  />
                                  <button
                                    onClick={() => saveReceiptItem(message.job_id, resultId, itemIdx, item, review)}
                                    disabled={isSavingItem || !review.account_id || !itemCatId || Number(item.finalAmount ?? item.amount ?? 0) <= 0}
                                    className="px-2 py-1.5 rounded-lg bg-[#2C6488] hover:bg-[#25536F] text-white text-[10px] font-semibold disabled:opacity-50 transition-colors flex-shrink-0"
                                  >
                                    {isSavingItem ? '...' : 'บันทึก'}
                                  </button>
                                  <button
                                    onClick={() => skipReceiptItem(message.job_id, resultId, itemIdx, review)}
                                    className="px-2 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-500 text-[10px] font-semibold border border-slate-200 transition-colors flex-shrink-0"
                                  >
                                    ไม่บันทึก
                                  </button>
                                </div>
                              </div>
                            ) : isSavedItem ? (
                              <div className="flex items-center gap-2 px-2.5 py-2">
                                <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="block truncate text-emerald-700 font-medium">{item.name || `รายการ ${itemIdx + 1}`}</span>
                                  <span className="block truncate text-[10px] text-emerald-600/80">
                                    หมวดหมู่: <span className="font-semibold">{getCategoryName(item.category_id || '')}</span>
                                  </span>
                                </div>
                                <span className="text-[11px] text-emerald-600 flex-shrink-0 font-semibold">฿{fmt(item.finalAmount)}</span>
                              </div>
                            ) : isSkippedItem ? (
                              <div className="flex items-center gap-2 px-2.5 py-2">
                                <span className="flex-1 truncate text-slate-400 line-through">{item.name || `รายการ ${itemIdx + 1}`}</span>
                                <span className="text-[10px] text-slate-400 flex-shrink-0">ไม่บันทึก</span>
                              </div>
                            ) : (
                              <div className="p-2 space-y-1.5">
                                <div className="flex items-baseline gap-2">
                                  <div className="flex-1 min-w-0">
                                    <span className="block truncate text-slate-700 font-semibold">{item.name || `รายการ ${itemIdx + 1}`}</span>
                                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                                      หมวดหมู่: <span className="font-semibold text-[#2C6488]">{getCategoryName(itemCatId)}</span>
                                    </span>
                                  </div>
                                  <span className="text-[11px] flex-shrink-0">
                                    {showArrow ? (
                                      <span className="text-slate-500">
                                        ฿{fmt(item.amount)} <span className="text-slate-300">→</span> <span className="font-bold text-slate-700">฿{fmt(item.finalAmount)}</span>
                                      </span>
                                    ) : (
                                      <span className="font-bold text-slate-700">฿{fmt(item.amount)}</span>
                                    )}
                                  </span>
                                </div>
                                {isDone && (
                                  <div className="flex gap-1.5">
                                    <ScanCatSelect
                                      value={itemCatId}
                                      onChange={(v) => updateItemInReview(resultId, itemIdx, { category_id: v })}
                                      categories={categoryOptions}
                                      compact
                                    />
                                    <button
                                      onClick={() => saveReceiptItem(message.job_id, resultId, itemIdx, item, review)}
                                      disabled={isSavingItem || !review.account_id || !itemCatId || Number(item.finalAmount ?? item.amount ?? 0) <= 0}
                                      className="px-2.5 py-1 rounded-lg bg-[#2C6488] hover:bg-[#25536F] text-white text-[10px] font-semibold disabled:opacity-50 transition-colors flex-shrink-0"
                                    >
                                      {isSavingItem ? '...' : 'บันทึก'}
                                    </button>
                                    <button
                                      onClick={() => skipReceiptItem(message.job_id, resultId, itemIdx, review)}
                                      className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 text-[10px] font-semibold border border-slate-200 transition-colors flex-shrink-0"
                                    >
                                      ไม่บันทึก
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Saved/skipped summary */}
                  {(isSaved || isSkipped) && (
                    <div>
                      <p className="text-xs text-slate-400">รวม ฿{fmt(finalItems.reduce((s, it) => s + it.amount, 0))}</p>
                    </div>
                  )}

                  {/* VAT + Discount */}
                  {isDone && !allReceiptItemsHandled && (
                    <div className="bg-[#F6FAFC] border border-[#EAF3F7] rounded-2xl p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold text-slate-400">VAT และส่วนลด</p>
                        {!isEditing && (
                          <span className="text-[10px] font-semibold text-slate-400">กดแก้ไขเพื่อปรับค่า</span>
                        )}
                      </div>
                      {isEditing ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500 w-14 flex-shrink-0">VAT (฿)</span>
                            <input
                              value={review.vatAmount || ''}
                              onChange={(e) => updateScanReview(resultId, { vatAmount: e.target.value })}
                              type="number" min="0" step="0.01" placeholder="0"
                              className={`w-20 text-right ${compactFieldClass}`}
                            />
                            <button
                              type="button"
                              onClick={() => updateScanReview(resultId, { vatMode: review.vatMode === 'include' ? 'exclude' : 'include' })}
                              className={`flex-1 min-w-0 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                                review.vatMode === 'include'
                                  ? 'bg-[#2C6488] text-white border-[#2C6488]'
                                  : 'bg-white text-[#2C6488] border-[#DCE8EE] hover:bg-[#EAF3F7]'
                              }`}
                            >
                              {review.vatMode === 'include' ? 'รวมในราคา' : 'บวกเพิ่ม'}
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500 w-14 flex-shrink-0">ส่วนลด (฿)</span>
                            <input
                              value={review.discountAmount || ''}
                              onChange={(e) => updateScanReview(resultId, { discountAmount: e.target.value })}
                              type="number" min="0" step="0.01" placeholder="0"
                              className={`w-20 text-right ${compactFieldClass}`}
                            />
                            <button
                              type="button"
                              onClick={() => updateScanReview(resultId, { discountMode: review.discountMode === 'prorate' ? 'ignore' : 'prorate' })}
                              className={`flex-1 min-w-0 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                                review.discountMode === 'prorate'
                                  ? 'bg-[#2C6488] text-white border-[#2C6488]'
                                  : 'bg-white text-[#2C6488] border-[#DCE8EE] hover:bg-[#EAF3F7]'
                              }`}
                            >
                              {review.discountMode === 'prorate' ? 'กระจาย' : 'ไม่คิด'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="rounded-xl bg-white border border-[#EAF3F7] px-2.5 py-2">
                            <p className="text-[10px] font-semibold text-slate-400">VAT</p>
                            <p className="text-xs font-bold text-slate-700">
                              {Number(review.vatAmount || 0) > 0 ? `฿${fmt(review.vatAmount)}` : 'ไม่มี'}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {review.vatMode === 'exclude' ? 'บวกเพิ่ม' : 'รวมในราคา'}
                            </p>
                          </div>
                          <div className="rounded-xl bg-white border border-[#EAF3F7] px-2.5 py-2">
                            <p className="text-[10px] font-semibold text-slate-400">ส่วนลด</p>
                            <p className="text-xs font-bold text-slate-700">
                              {Number(review.discountAmount || 0) > 0 ? `฿${fmt(review.discountAmount)}` : 'ไม่มี'}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {review.discountMode === 'prorate' ? 'กระจายตามรายการ' : 'ไม่คิดส่วนลด'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Account + actions */}
                  {isDone && !allReceiptItemsHandled && (
                    <div className="space-y-1.5">
                      <ScanAccSelect
                        value={review.account_id || ''}
                        onChange={(v) => updateScanReview(resultId, { account_id: v })}
                        accounts={assetAccounts}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => saveReceiptAll(message.job_id, resultId, review)}
                          disabled={isBusy || !review.account_id}
                          className="py-2 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white text-xs font-semibold disabled:opacity-60 transition-colors"
                        >
                          บันทึกทั้งหมด
                        </button>
                        <button
                          onClick={() => skipScanResult(message.job_id, resultId)}
                          disabled={isBusy}
                          className="py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-500 text-xs font-semibold border border-slate-200 disabled:opacity-60 transition-colors"
                        >
                          ไม่บันทึกทั้งหมด
                        </button>
                      </div>
                      <div className="flex">
                        <button
                          onClick={() => setScanEditMode((prev) => ({ ...prev, [resultId]: !prev[resultId] }))}
                          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                            isEditing
                              ? 'bg-[#2C6488] hover:bg-[#25536F] text-white border-[#2C6488]'
                              : 'bg-[#EAF3F7] hover:bg-[#DCE8EE] text-[#2C6488] border-[#DCE8EE]'
                          }`}
                        >
                          {isEditing ? <Check size={12} /> : <Edit3 size={12} />}
                          {isEditing ? 'เสร็จ' : 'แก้ไข'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        </div>
      );
    }
    if (message.role === 'scan_job') {
      const total = Number(message.total_count || 0);
      const done = Number(message.done_count || 0);
      const isActive = ['pending', 'processing'].includes(message.status);
      const isCancelled = message.status === 'cancelled';
      const isDoneState = message.status === 'done';
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      const ready = Number(message.ready_count || 0);
      const saved = Number(message.saved_count || 0);
      const skipped = Number(message.skipped_count || 0);
      const rejected = Number(message.rejected_count || 0);
      const errors = Number(message.error_count || 0);
      const duplicates = Number(message.duplicate_count || 0);
      const receipts = Number(message.receipt_count || 0);
      const slips = Number(message.slip_count || 0);
      if (!isActive && !isCancelled && !isDoneState) return null;

      const scanJobPills = [
        ready > 0 ? { label: `รอตรวจ ${ready}`, className: 'bg-[#EAF3F7] text-[#2C6488] border-[#DCE8EE]' } : null,
        saved > 0 ? { label: `บันทึกแล้ว ${saved}`, className: 'bg-emerald-50 text-emerald-600 border-emerald-100' } : null,
        skipped > 0 ? { label: `ไม่บันทึก ${skipped}`, className: 'bg-slate-100 text-slate-500 border-slate-200' } : null,
        rejected > 0 ? { label: `ไม่ผ่าน ${rejected}`, className: 'bg-red-50 text-red-500 border-red-100' } : null,
        errors > 0 ? { label: `ผิดพลาด ${errors}`, className: 'bg-red-50 text-red-500 border-red-100' } : null,
        duplicates > 0 ? { label: `สลิปซ้ำ ${duplicates}`, className: 'bg-amber-50 text-amber-600 border-amber-100' } : null,
        receipts > 0 ? { label: `ใบเสร็จ ${receipts}`, className: 'bg-white text-slate-500 border-slate-200' } : null,
        slips > 0 ? { label: `สลิป ${slips}`, className: 'bg-white text-slate-500 border-slate-200' } : null,
      ].filter(Boolean);

      return (
        <div key={message.id} className="flex justify-start animate-message-left">
          <div className="max-w-[86%] md:max-w-[72%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-sm px-3 py-2.5 space-y-1.5">
            {isCancelled ? (
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <AlertCircle size={13} className="text-red-400" />
                ยกเลิกงานสแกนแล้ว
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    {isActive ? (
                      <RefreshCw size={12} className="animate-spin text-[#2C6488]" />
                    ) : (
                      <CheckCircle2 size={13} className="text-[#2C6488]" />
                    )}
                    {isActive ? 'กำลังสแกนเอกสาร' : 'สแกนเสร็จแล้ว รอตรวจสอบ'} {done}/{total}
                  </span>
                  <button
                    onClick={() => cancelScanJob(message.job_id)}
                    className={`${isActive ? '' : 'hidden'} text-[11px] text-red-400 hover:text-red-600 font-semibold transition-colors`}
                  >
                    ยกเลิก
                  </button>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div className="h-full bg-[#2C6488] transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                {scanJobPills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {scanJobPills.map((pill) => (
                      <span key={pill.label} className={`text-[10px] font-bold px-2 py-1 rounded-full border ${pill.className}`}>
                        {pill.label}
                      </span>
                    ))}
                  </div>
                )}
                {message.error_msg && (
                  <p className="text-[11px] text-red-500">{message.error_msg}</p>
                )}
              </>
            )}
          </div>
        </div>
      );
    }

    if (message.role === 'preview') {
      const meta = MODE_META[message.mode];
      return (
        <div key={message.id} className="flex justify-start animate-message-left">
          <div className="max-w-[90%] md:max-w-[75%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-md p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-700/50 pb-1.5">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: meta.tone, background: meta.bg }}>
                {meta.label}
              </span>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Info size={11} />
                <span>ตรวจสอบข้อมูลธุรกรรม</span>
              </span>
            </div>
            
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{message.result.title}</p>
                {(message.mode === 'income' || message.mode === 'expense') && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    หมวดหมู่: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.category?.name || 'ไม่ได้เลือก'}</span>
                  </p>
                )}
                {message.mode === 'saving' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    เป้าหมายการออม: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.goal?.name || '-'}</span>
                  </p>
                )}
                {message.mode === 'transfer' ? (
                  <>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      จากบัญชี: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.account?.name || '-'}</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      ไปบัญชี: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.toAccount?.name || '-'}</span>
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    กระเป๋าเงินบัญชี: <span className="font-semibold text-slate-700 dark:text-slate-200">{message.account?.name || '-'}</span>
                  </p>
                )}
              </div>
              <p className="text-xl font-bold whitespace-nowrap" style={{ color: meta.tone }}>
                ฿{fmt(message.result.amount)}
              </p>
            </div>

            {message.mode === 'expense' && (
              <BudgetImpactBar 
                categoryId={message.category?.id} 
                amount={Number(message.result.amount || 0)} 
                budgets={budgets}
                categories={categories}
                readonly={!!message.readonly}
              />
            )}

            {!message.readonly && (
              <div className="pt-2 flex flex-wrap gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3.5 py-2 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
                >
                  <span className="flex items-center gap-1.5">
                    <Check size={13} />
                    <span>{saving ? 'กำลังบันทึก...' : 'บันทึกธุรกรรม'}</span>
                  </span>
                </button>
                {(message.mode === 'income' || message.mode === 'expense') && (
                  <button
                    onClick={() => askCategory(message.result, {
                      accountId: message.account?.id || accountId,
                      toAccountId: message.toAccount?.id || toAccountId,
                      goalId: message.goal?.id || goalId,
                    })}
                    className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-600 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Edit3 size={13} />
                      <span>เปลี่ยนหมวด</span>
                    </span>
                  </button>
                )}
                <button
                  onClick={() => askAccountForPreview(message.result)}
                  className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-600 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-600 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <CreditCard size={13} />
                    <span>{message.mode === 'transfer' ? 'เปลี่ยนบัญชีโอน' : 'เปลี่ยนบัญชี'}</span>
                  </span>
                </button>
                <button
                  onClick={() => handleCancelPreview(message.id, message.result.title, message.result.amount)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-900/30 text-red-650 dark:text-red-400 text-xs font-semibold border border-red-100 dark:border-red-900/40 transition-colors"
                >
                  <Trash2 size={12} />
                  <span>ยกเลิก</span>
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (message.role === 'notification') {
      // ซ่อน noti บางชนิดไม่ให้แสดงในแชท (รวมถึงที่เคยถูกบันทึกไว้ใน chat log เดิม)
      if (isChatHiddenNoti(message.notification_type)) return null;

      let badgeBg = 'bg-slate-50 text-slate-500';
      let iconElement = <HelpCircle size={13} />;
      let label = 'การแจ้งเตือน';

      if (message.notification_type === 'recurring') {
        badgeBg = 'bg-blue-50 dark:bg-slate-700/50 text-[#2C6488] dark:text-[#4da2db]';
        iconElement = <Repeat2 size={13} />;
        label = 'รายการประจำ';
      } else if (message.notification_type === 'budget_over') {
        badgeBg = 'bg-red-50 dark:bg-red-950/45 text-red-500';
        iconElement = <AlertCircle size={13} />;
        label = 'งบประมาณเกิน';
      } else if (message.notification_type === 'budget_near_limit') {
        badgeBg = 'bg-amber-50 dark:bg-amber-950/40 text-amber-500';
        iconElement = <AlertCircle size={13} />;
        label = 'งบประมาณใกล้เต็ม';
      } else if (message.notification_type === 'goal_due') {
        badgeBg = 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600';
        iconElement = <PiggyBank size={13} />;
        label = 'เป้าหมายการออม';
      } else if (aiNotificationPeriod(message.notification_type)) {
        badgeBg = 'bg-[#EAF3F7] dark:bg-slate-700/50 text-[#2C6488] dark:text-[#4da2db]';
        iconElement = <Sparkles size={13} />;
        label = 'สรุปการเงิน';
      }

      return (
        <div key={message.id} className="flex justify-start animate-message-left">
          <div className="max-w-[90%] md:max-w-[75%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-md p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-3 border-b border-slate-50 dark:border-slate-700/50 pb-1.5">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeBg}`}>
                {iconElement}
                <span>{label}</span>
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {message.created_at ? new Date(message.created_at).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' }) : 'วันนี้'}
              </span>
            </div>

            <div className="space-y-1">
              <h4 className="font-bold text-slate-800 dark:text-slate-200 text-sm">{message.title}</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">{message.text}</p>
            </div>

            {message.notification_type === 'recurring' && (
              <div className="pt-1 flex gap-2">
                {message.action_taken ? (
                  message.recurringAction === 'skipped' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-semibold bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                      <ArrowRight size={13} />
                      <span>ข้ามรอบนี้แล้ว · เลื่อนไปงวดถัดไป</span>
                    </span>
                  ) : message.recurringAction === 'confirmed' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500 font-semibold bg-emerald-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-emerald-100 dark:border-slate-700">
                      <Check size={13} />
                      <span>บันทึกสำเร็จเรียบร้อย</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 font-semibold bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                      <Check size={13} />
                      <span>ดำเนินการแล้ว</span>
                    </span>
                  )
                ) : (
                  <>
                    <button
                      onClick={() => handleConfirmNotification(message.originalNoti, message.id)}
                      className="px-3 py-1.5 rounded-xl bg-[#2C6488] hover:bg-[#25536F] text-white text-xs font-semibold shadow-sm transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        <Check size={12} />
                        <span>บันทึกรายการ</span>
                      </span>
                    </button>
                    <button
                      onClick={() => handleSkipNotification(message.originalNoti, message.id)}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-650 text-slate-650 dark:text-slate-350 text-xs font-semibold transition-colors"
                    >
                      <span>ข้ามรอบนี้</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (message.role === 'ai_summary') {
      const summary = message.summary || {};
      const isWeekly = message.period === 'weekly';
      return (
        <div key={message.id} className="flex justify-start animate-message-left w-full">
          <div className="w-full max-w-[95%] md:max-w-[85%] rounded-2xl rounded-bl-md bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 shadow-md p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-700/50 pb-2">
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-yellow-50 dark:bg-slate-750 text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                <Sparkles size={12} className="text-yellow-500" />
                <span>วิเคราะห์การเงินราย{isWeekly ? 'สัปดาห์' : 'เดือน'}ด้วย AI</span>
              </span>
              <div className="flex items-center gap-1.5">
                {message.period_start && message.period_end && (
                  <span className="hidden sm:inline text-[10px] text-slate-400">
                    {formatDisplayDateRange(message.period_start, message.period_end)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setExpandedAiSummary(message)}
                  className="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 inline-flex items-center justify-center hover:bg-slate-100 dark:bg-slate-700/70 dark:hover:bg-slate-700"
                  title="ขยายดูสรุปการเงิน"
                >
                  <Maximize2 size={14} />
                </button>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-[#2C6488] dark:text-[#4da2db]">{summary.title || 'วิเคราะห์สถิติภาพรวม'}</h4>
              <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed mt-1.5">{summary.overview}</p>
            </div>

            {summary.highlights?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-450 flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-emerald-500 flex-shrink-0" />
                  <span>จุดเด่นทางการเงิน</span>
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  {summary.highlights.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.cautions?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
                  <span>ข้อพึงระวังด้านบัญชี</span>
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  {summary.cautions.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.suggestions?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <Info size={13} className="text-[#2C6488] dark:text-[#4da2db] flex-shrink-0" />
                  <span>แนวทางคำแนะนำแก้ไข</span>
                </p>
                <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  {summary.suggestions.map((item, idx) => (
                    <li key={idx} className="leading-relaxed">{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      );
    }

    const isUser = message.role === 'user';
    return (
      <div key={message.id} className={`flex ${isUser ? 'justify-end animate-message-right' : 'justify-start animate-message-left'}`}>
        <div className={`max-w-[82%] md:max-w-[70%] rounded-2xl px-3 py-2 text-[13px] leading-5 ${
          isUser
            ? 'rounded-br-none bg-[#2C6488] text-white shadow-sm'
            : 'rounded-bl-none bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 text-slate-700 dark:text-slate-350 shadow-sm'
        }`}>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <span className="whitespace-pre-wrap">{message.text}</span>
            </div>
            {!isUser && message.success && (
              <CheckCircle2 size={16} color="#10b981" className="mt-0.5 flex-shrink-0" />
            )}
          </div>
          {message.actions && message.choiceActive !== false && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.actions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => {
                    const shouldClose = action.onClick?.();
                    if (shouldClose !== false) closeActiveChoices(message.id);
                  }}
                  className="px-2.5 py-1.5 rounded-xl bg-[#EAF3F7] hover:bg-[#DCE8EE] dark:bg-slate-700/80 dark:hover:bg-slate-650 text-[#2C6488] dark:text-[#4da2db] text-[11px] font-bold border border-[#DCE8EE]/50 dark:border-slate-600 transition-colors"
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => closeActiveChoices(message.id)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/80 dark:hover:bg-slate-650 text-slate-500 dark:text-slate-300 text-[11px] font-bold border border-slate-200 dark:border-slate-600 transition-colors"
              >
                ปิด
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const currentScanImage = scanImageViewer?.images?.[scanImageViewer.index] || null;
  const scanImageCount = scanImageViewer?.images?.length || 0;
  const canGoPrevScanImage = scanImageViewer?.index > 0;
  const canGoNextScanImage = scanImageViewer && scanImageViewer.index < scanImageCount - 1;
  const expandedSummary = expandedAiSummary?.summary || null;
  const expandedIsWeekly = expandedAiSummary?.period === 'weekly';
  const pendingReadyScanMessages = messages.filter((msg) => {
    if (msg.role !== 'scan_result' || msg.status !== 'done' || !msg.result_id) return false;
    if (msg.document_type === 'receipt') {
      const review = scanReview[msg.result_id];
      const finalItems = getReceiptReviewFinalItems(review);
      if (finalItems.length === 0) return false;
      return finalItems.some((_, itemIdx) => {
        const itemStatus = scanItemState[`${msg.result_id}-${itemIdx}`];
        return itemStatus !== 'saved' && itemStatus !== 'skipped';
      });
    }
    return msg.document_type === 'slip';
  });
  const pendingReadyScanCount = pendingReadyScanMessages.length;

  const handleSaveAllReadyScans = async () => {
    if (scanBulkSaving || pendingReadyScanMessages.length === 0) return;
    setScanBulkSaving(true);
    try {
      for (const msg of pendingReadyScanMessages) {
        if (msg.document_type === 'receipt') {
          const review = scanReview[msg.result_id] || buildScanReviewValue({
            id: msg.result_id,
            document_type: msg.document_type,
            data: msg.data,
          });
          await saveReceiptAll(msg.job_id, msg.result_id, review);
        } else if (msg.document_type === 'slip') {
          await saveScanResult(msg.job_id, {
            id: msg.result_id,
            document_type: msg.document_type,
            slip: msg.slip,
            data: msg.data,
            image_path: msg.image_path,
          });
        }
      }
    } finally {
      setScanBulkSaving(false);
    }
  };
  const goToScanImage = (direction) => {
    setScanImageViewer((prev) => {
      const count = prev?.images?.length || 0;
      if (!prev || count <= 1) return prev;
      const nextIndex = prev.index + direction;
      if (nextIndex < 0 || nextIndex >= count) return prev;
      return {
        ...prev,
        index: nextIndex,
      };
    });
  };

  useEffect(() => {
    if (!scanImageViewer) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setScanImageViewer(null);
      if (e.key === 'ArrowLeft') goToScanImage(-1);
      if (e.key === 'ArrowRight') goToScanImage(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scanImageViewer]);

  // ล้างประวัติแชทไม่ได้ถ้ากำลังทำงานอยู่ หรือมีรายการที่ยังไม่บันทึก
  const hasInFlightScans = messages.some(
    (msg) => msg.role === 'scan_result' && (msg.status === 'uploading' || msg.status === 'scanning')
  );
  const canClearChat = chatLoaded
    && !parsing && !saving && !aiLoading && !scanUploading && !scanBulkSaving
    && !Object.values(scanSaving).some(Boolean)
    && !hasInFlightScans
    && parsed == null && pendingText.trim() === '' && pendingReadyScanCount === 0;

  return (
    <>
    <div className="p-3 md:p-4 w-full max-w-5xl mx-auto flex-1 flex flex-col min-h-0 relative">
      {/* Main Single Chat Container (frameless) */}
      <div className="relative flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-hidden h-full">
        
        {/* Header (centered minimal) */}
        <div className="relative px-5 pt-1 pb-1.5 flex flex-col items-center text-center flex-shrink-0 border-b border-slate-200/70 dark:border-slate-800">
          <button
            onClick={() => { if (canClearChat) clearChatLog(); }}
            disabled={!canClearChat}
            title={canClearChat ? "ล้างประวัติแชท" : "ล้างไม่ได้ขณะกำลังทำงานหรือมีรายการที่ยังไม่บันทึก"}
            aria-label="ล้างประวัติแชท"
            className="absolute right-4 top-2 w-9 h-9 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <Trash2 size={16} />
          </button>
          <div className="w-9 h-9 rounded-full bg-[#EAF3F7] dark:bg-slate-700 flex items-center justify-center mb-1">
            <MessageCircle size={18} className="text-[#2C6488] dark:text-[#4da2db]" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">แชท PaoJot</h3>
        </div>



        {/* Scrollable Chat Area */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3"
        >
          {/* Welcome User Guide Card */}
          <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 rounded-2xl p-3.5 mb-3 space-y-3 shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-700/50 pb-2">
              <MessageCircle className="text-[#2C6488] dark:text-[#4da2db]" size={18} />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200">คู่มือและวิธีการกรอกข้อมูลในช่องแชท</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1.5">
                <h4 className="font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <Edit3 size={13} />
                  <span>1. วิธีการจดบันทึกรายวัน</span>
                </h4>
                <ul className="list-disc list-inside text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  <li><strong>รายจ่าย</strong>: พิมพ์ "ข้าวแกง 50"</li>
                  <li><strong>รายรับ</strong>: พิมพ์ "เงินเดือน 30000"</li>
                  <li><strong>การออม</strong>: พิมพ์ "ออม 500"</li>
                  <li><strong>การโอน</strong>: พิมพ์ "โอน 300"</li>
                </ul>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <ImagePlus size={13} />
                  <span>2. อัปโหลดเอกสาร</span>
                </h4>
                <ul className="list-disc list-inside text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                  <li>แนบรูปใบเสร็จหรือสลิปได้จากปุ่มรูปภาพ</li>
                  <li>รองรับไฟล์ JPG, PNG และ HEIC</li>
                  <li>ระบบจะแยกประเภทเอกสารให้อัตโนมัติ</li>
                  <li>ตรวจสอบข้อมูล แล้วเลือกบันทึกหรือข้ามรายการ</li>
                </ul>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-bold text-[#2C6488] dark:text-[#4da2db] flex items-center gap-1.5">
                  <Sparkles size={13} className="text-yellow-500" />
                  <span>3. ระบบแจ้งเตือน & AI</span>
                </h4>
                <p className="text-slate-500 dark:text-slate-400 leading-normal pl-1">
                  สัญญาณเตือนเกี่ยวกับงบประมาณ งวดโอนเงินประจำ หรือรายงานการวิเคราะห์รายสัปดาห์/เดือน จะถูกส่งเข้ามาตอบโต้ในหน้านี้โดยตรง
                </p>
              </div>
            </div>
          </div>

          {messages.map(renderMsg)}
          
          {parsing && (
            <div className="flex justify-start animate-message-left">
              <div className="rounded-2xl rounded-bl-none bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 px-3 py-2 text-xs text-slate-500 shadow-sm flex items-center gap-2">
                <span className="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                <span>กำลังตีความรายละเอียดธุรกรรม...</span>
              </div>
            </div>
          )}
          


          {aiLoading && (
            <div className="flex justify-start animate-message-left">
              <div className="rounded-2xl rounded-bl-none bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 px-3 py-2 text-xs text-slate-500 shadow-sm flex items-center gap-2">
                <span className="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                <span>AI กำลังประมวลผลข้อมูลบทวิเคราะห์ภาพรวมการเงิน...</span>
              </div>
            </div>
          )}



          <div ref={chatBottomRef} />
        </div>

        {pendingScanCue.visible && (
          <button
            type="button"
            onClick={scrollToFirstPendingScanResult}
            className="absolute left-1/2 bottom-[8.75rem] z-30 -translate-x-1/2 rounded-full border border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 shadow-lg shadow-amber-100/70 hover:bg-amber-100 transition-colors"
          >
            ยังไม่บันทึก {pendingScanCue.count} รายการ
          </button>
        )}

        {/* Quick Action Chips Bar */}
        <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-850 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-center gap-1.5 flex-shrink-0">
          <button 
            onClick={() => changeMode('expense')}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'expense'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <ArrowDown size={13} strokeWidth={2.6} className={mode === 'expense' ? 'text-white' : 'text-red-500'} />
            <span>จดรายจ่าย</span>
          </button>

          <button 
            onClick={() => changeMode('income')}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'income'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <ArrowUp size={13} strokeWidth={2.6} className={mode === 'income' ? 'text-white' : 'text-emerald-500'} />
            <span>จดรายรับ</span>
          </button>

          <button
            onClick={() => changeMode('transfer')}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'transfer'
                ? 'bg-[#2C6488] border-[#2C6488] text-white font-extrabold hover:bg-[#25536F]'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <ArrowLeftRight size={13} strokeWidth={2.5} className={mode === 'transfer' ? 'text-white' : 'text-blue-600'} />
            <span>บันทึกการโอน</span>
          </button>

          <button
            onClick={() => changeMode('saving')}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-bold transition-all flex items-center gap-1.5 shadow-sm ${
              mode === 'saving'
                ? 'bg-sky-500 border-sky-500 text-white font-extrabold hover:bg-sky-600'
                : 'bg-white dark:bg-slate-800 border-slate-200/60 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
            }`}
          >
            <PiggyBank size={13} strokeWidth={2.5} className={mode === 'saving' ? 'text-white' : 'text-sky-500'} />
            <span>บันทึกการออม</span>
          </button>

          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 self-center" />

          <button
            onClick={() => handleGenerateSummaryInline('weekly')}
            disabled={aiLoading || !weeklyEligible}
            title={weeklyEligible ? 'สร้างสรุปการเงินรายสัปดาห์ด้วย AI' : weeklyHint}
            className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-[11px] font-bold text-[#2C6488] dark:text-[#4da2db] hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Sparkles size={12} className="text-yellow-500" />
            <span>สร้างสรุปรายสัปดาห์</span>
          </button>

          <button
            onClick={() => handleGenerateSummaryInline('monthly')}
            disabled={aiLoading || !monthlyEligible}
            title={monthlyEligible ? 'สร้างสรุปการเงินรายเดือนด้วย AI' : monthlyHint}
            className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-[11px] font-bold text-[#2C6488] dark:text-[#4da2db] hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Calendar size={12} className="text-blue-500" />
            <span>สร้างสรุปรายเดือน</span>
          </button>

          <button 
            onClick={handleGuideScroll}
            className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 text-[11px] font-bold text-slate-500 dark:text-slate-455 hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <HelpCircle size={12} />
            <span>ดูคู่มือใช้งาน</span>
          </button>

          {pendingReadyScanCount > 0 && (
            <button
              type="button"
              onClick={handleSaveAllReadyScans}
              disabled={scanBulkSaving}
              className="px-2.5 py-1 rounded-full bg-[#2C6488] border border-[#2C6488] text-[11px] font-bold text-white hover:bg-[#25536F] transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {scanBulkSaving ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <CheckCircle2 size={12} />
              )}
              <span>{scanBulkSaving ? 'กำลังบันทึก...' : `บันทึกทั้งหมด ${pendingReadyScanCount}`}</span>
            </button>
          )}
        </div>

        {/* Chat Text Input Bar & Upload triggers */}
        <div className="p-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex-shrink-0">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            onPaste={handleComposerPaste}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const files = Array.from(e.dataTransfer.files || []);
              if (files.length && requireAccountBeforeScanUpload()) handleScanFiles(files);
            }}
            className="relative max-w-4xl mx-auto overflow-visible rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800 p-2 shadow-md transition-all focus-within:border-[#2C6488] focus-within:ring-2 focus-within:ring-[#2C6488]/25"
          >
            {/* Hidden file input for scan upload */}
            <input
              ref={scanFileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleScanFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            {/* Hidden camera input (mobile/tablet) */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleScanFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            {/* Main Input Text Field (multiline, auto-grow) */}
            <textarea
              ref={inputTextareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={MODE_META[mode].placeholder}
              disabled={!chatLoaded || parsing || aiLoading}
              rows={1}
              maxLength={80}
              className="block w-full resize-none overflow-hidden border-none bg-transparent px-1.5 py-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-60"
              style={{ minHeight: '48px' }}
            />

            {/* Toolbar Row */}
            <div className="mt-1 flex items-center gap-1">
              {/* Attach (+) menu */}
              <div className="relative" ref={attachMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAttachMenu((o) => !o)}
                  disabled={scanUploading}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-60 ${
                    showAttachMenu
                      ? 'bg-[#2C6488]/10 text-[#2C6488] dark:text-[#4da2db]'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                  aria-label="แนบไฟล์"
                  title="แนบรูปใบเสร็จ / สลิป"
                >
                  <Plus size={18} style={{ transform: showAttachMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-11 left-0 z-50 w-60 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        if (requireAccountBeforeScanUpload()) scanFileRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      <ImagePlus size={16} className="text-[#2C6488] dark:text-[#4da2db] flex-shrink-0" />
                      <span>สแกนใบเสร็จ / สลิป</span>
                    </button>
                    {canCapture && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenu(false);
                          if (requireAccountBeforeScanUpload()) cameraInputRef.current?.click();
                        }}
                        className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        <Camera size={16} className="text-[#2C6488] dark:text-[#4da2db] flex-shrink-0" />
                        <span>ถ่ายรูป</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Active Mode Indicator Badge */}
              <span
                className="text-[11px] font-extrabold px-2 py-1 rounded-xl flex items-center gap-1.5 transition-all select-none flex-shrink-0"
                style={{
                  color: MODE_META[mode].tone,
                  backgroundColor: MODE_META[mode].bg,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: MODE_META[mode].tone }} />
                <span>{MODE_META[mode].label}</span>
              </span>


              <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                {/* Send Button */}
                <button
                  type="submit"
                  disabled={parsing || saving || aiLoading || !chatLoaded || !input.trim()}
                  className="w-8 h-8 rounded-lg bg-[#2C6488] hover:bg-[#25536F] text-white flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="ส่งข้อความ"
                >
                  <ArrowUp size={17} />
                </button>
              </div>
            </div>

            {/* Drag & Drop Overlay */}
            <div
              className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-[#2C6488] bg-[#EAF3F7]/90 dark:bg-slate-800/90 text-sm font-semibold text-[#2C6488] dark:text-[#4da2db] transition-opacity duration-200 ${
                isDragOver ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <ImagePlus size={18} />
                วางรูปที่นี่เพื่อสแกนใบเสร็จ / สลิป
              </span>
            </div>
          </form>
        </div>

      </div>
    </div>

    {/* Scan Image Lightbox */}
    {scanImageViewer && currentScanImage && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={() => setScanImageViewer(null)}
      >
        <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <img
            src={currentScanImage.src}
            alt={currentScanImage.title || 'scan'}
            className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
          {scanImageCount > 1 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => goToScanImage(-1)}
                disabled={!canGoPrevScanImage}
                className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-40 transition-colors"
              >
                ‹
              </button>
              <span className="text-white text-sm font-semibold">
                {(scanImageViewer.index ?? 0) + 1} / {scanImageCount}
              </span>
              <button
                onClick={() => goToScanImage(1)}
                disabled={!canGoNextScanImage}
                className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-40 transition-colors"
              >
                ›
              </button>
            </div>
          )}
          <button
            onClick={() => setScanImageViewer(null)}
            className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    )}
    {expandedAiSummary && expandedSummary && createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 max-w-2xl w-full max-h-[85vh] flex flex-col p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-700 pb-4 mb-4 flex-shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Sparkles size={18} className="text-[#2C6488]" />
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  สรุปการเงินราย{expandedIsWeekly ? 'สัปดาห์' : 'เดือน'}
                </h2>
                {expandedAiSummary.auto && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EAF3F7] text-[#2C6488] border border-[#DCE8EE]">
                    แจ้งเตือนอัตโนมัติ
                  </span>
                )}
              </div>
              {expandedAiSummary.period_start && expandedAiSummary.period_end && (
                <p className="text-xs text-slate-400 mt-1">
                  ช่วงวันที่วิเคราะห์: {formatDisplayDateRange(expandedAiSummary.period_start, expandedAiSummary.period_end)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setExpandedAiSummary(null)}
              className="w-9 h-9 rounded-xl bg-slate-50 text-slate-500 inline-flex items-center justify-center hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-5">
            <div className="rounded-2xl bg-[#EAF3F7] border border-[#DCE8EE] p-4">
              <h4 className="text-sm font-bold text-[#2C6488] mb-1.5">{expandedSummary.title || 'สรุปการเงิน'}</h4>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{expandedSummary.overview}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {expandedSummary.highlights?.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                  <h4 className="text-xs font-bold text-slate-500 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-emerald-500" />
                    จุดเด่นทางการเงิน
                  </h4>
                  <div className="space-y-2.5 pl-3">
                    {expandedSummary.highlights.map((item, idx) => (
                      <p key={idx} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed relative before:content-['•'] before:absolute before:-left-3 before:text-[#2C6488]">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {expandedSummary.cautions?.length > 0 && (
                <div className="bg-amber-50/70 dark:bg-amber-950/20 rounded-2xl p-4 border border-amber-100 dark:border-amber-900/40">
                  <h4 className="text-xs font-bold text-amber-800 dark:text-amber-400 mb-3 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-amber-600" />
                    ข้อพึงระวังด้านบัญชี
                  </h4>
                  <div className="space-y-2 pl-1">
                    {expandedSummary.cautions.map((item, idx) => (
                      <p key={idx} className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">• {item}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {expandedSummary.suggestions?.length > 0 && (
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                <h4 className="text-xs font-bold text-slate-500 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                  <Info size={14} className="text-[#2C6488]" />
                  แนวทางคำแนะนำแก้ไข
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-1">
                  {expandedSummary.suggestions.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-[10px]">
                        {idx + 1}
                      </span>
                      <p className="flex-1">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 dark:border-slate-700 pt-3 mt-4 flex items-center justify-between flex-shrink-0">
            <p className="text-[10px] text-slate-400 italic">
              *คำแนะนำนี้เป็นคำแนะนำเบื้องต้นจาก AI*
            </p>
            <button
              type="button"
              onClick={() => setExpandedAiSummary(null)}
              className="px-4 py-2 rounded-xl bg-[#2C6488] text-white text-xs font-semibold hover:bg-[#204a66]"
            >
              ปิดหน้าต่าง
            </button>
      
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  );
}
