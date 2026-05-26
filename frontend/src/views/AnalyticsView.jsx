import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../components/common/Icon';
import { Sun, Calendar, BarChart2, TrendingUp, Wallet, ReceiptText, AlertCircle, Sparkles, RefreshCw, X, Maximize2 } from 'lucide-react';
import { transactions as txApi, profile as profileApi, aiSummary as aiSummaryApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDate, formatDisplayDateRange } from '../utils/dateFormat';

// ─── Constants ───────────────────────────────────────────────────────────────
const MONTH_LABELS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const FULL_MONTH_LABELS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const FALLBACK_CATEGORY_COLOR = '#94a3b8';

const PERIOD_CONFIG = [
  { id: 'today', label: 'วันนี้',     icon: 'Sun',      color: '#2C6488', bg: '#EAF3F7', ring: '#BFD8E4' },
  { id: 'week',  label: 'สัปดาห์นี้', icon: 'Calendar', color: '#2C6488', bg: '#EAF3F7', ring: '#BFD8E4' },
  { id: 'month', label: 'เดือนนี้',   icon: 'BarChart2', color: '#2C6488', bg: '#EAF3F7', ring: '#BFD8E4' },
  { id: 'year',  label: 'ปีนี้',      icon: 'TrendingUp', color: '#2C6488', bg: '#EAF3F7', ring: '#BFD8E4' },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function toYMD(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function getDateRange(period, weekStartDay) {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = now.getMonth();

  switch (period) {
    case 'today': {
      const s = toYMD(now);
      return { from: s, to: s };
    }
    case 'week': {
      const dow  = now.getDay();          // 0=Sun … 6=Sat
      let   diff = dow - weekStartDay;
      if (diff < 0) diff += 7;
      const start = new Date(now);
      start.setDate(now.getDate() - diff);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { from: toYMD(start), to: toYMD(end) };
    }
    case 'month': {
      return {
        from: toYMD(new Date(y, m, 1)),
        to:   toYMD(new Date(y, m + 1, 0)),
      };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: {
      const s = toYMD(now);
      return { from: s, to: s };
    }
  }
}

function periodDateLabel(period, weekStartDay) {
  const { from, to } = getDateRange(period, weekStartDay);
  return period === 'today' ? formatThaiLongDate(from) : formatThaiLongDateRange(from, to);
}

function parseYMD(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatThaiLongDate(value) {
  const date = parseYMD(value);
  if (!date) return '-';
  return `${date.day} ${FULL_MONTH_LABELS[date.month - 1]} ${date.year}`;
}

function formatThaiLongDateRange(from, to) {
  const start = formatThaiLongDate(from);
  const end = formatThaiLongDate(to);
  if (start === '-' && end === '-') return '-';
  if (start === end || end === '-') return start;
  if (start === '-') return end;
  return `${start} - ${end}`;
}

// ─── Chart: Doughnut ─────────────────────────────────────────────────────────
function DonutChart({ data, isDarkMode }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    const C = window.Chart;
    if (!canvasRef.current || !C) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    if (data.length === 0) return;

    chartRef.current = new C(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels:   data.map((d) => d.label),
        datasets: [{
          data:            data.map((d) => d.value),
          backgroundColor: data.map((d) => d.color || FALLBACK_CATEGORY_COLOR),
          borderWidth: 2,
          borderColor: isDarkMode ? '#131926' : '#ffffff',
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: false,
        animation:  false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ฿${fmt(ctx.raw)}` } },
        },
        cutout: '68%',
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data, isDarkMode]);

  return <canvas ref={canvasRef} width={160} height={160} />;
}

// ─── Chart: Bar ───────────────────────────────────────────────────────────────
function BarChart({ data, isDarkMode }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    const C = window.Chart;
    if (!canvasRef.current || !C) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    chartRef.current = new C(canvasRef.current, {
      type: 'bar',
      data: {
        labels:   data.map((d) => d.month),
        datasets: [
          {
            label:           'รายรับ',
            data:            data.map((d) => d.income),
            backgroundColor: '#34d399',
            borderRadius:    5,
            barPercentage:   0.7,
          },
          {
            label:           'รายจ่าย',
            data:            data.map((d) => d.expense),
            backgroundColor: '#fb7185',
            borderRadius:    5,
            barPercentage:   0.7,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ฿${fmt(ctx.raw)}` } },
        },
        scales: {
          x: {
            grid:  { display: false },
            ticks: { font: { size: 11 }, color: '#94a3b8' },
          },
          y: {
            grid:  { color: isDarkMode ? '#24304c' : '#f1f5f9' },
            ticks: {
              font:     { size: 11 },
              color:    '#94a3b8',
              callback: (v) => v >= 1000 ? `฿${(v / 1000).toFixed(0)}K` : `฿${v}`,
            },
          },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data, isDarkMode]);

  return <div className="h-48"><canvas ref={canvasRef} /></div>;
}

// ─── Chart: Line (Spending Trend) ──────────────────────────────────────────
function LineChart({ data, isDarkMode }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    const C = window.Chart;
    if (!canvasRef.current || !C) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const ctx = canvasRef.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    if (isDarkMode) {
      gradient.addColorStop(0, 'rgba(77, 162, 219, 0.4)');
      gradient.addColorStop(1, 'rgba(77, 162, 219, 0.0)');
    } else {
      gradient.addColorStop(0, 'rgba(44, 100, 136, 0.3)');
      gradient.addColorStop(1, 'rgba(44, 100, 136, 0.0)');
    }

    chartRef.current = new C(canvasRef.current, {
      type: 'line',
      data: {
        labels:   data.map((d) => d.label),
        datasets: [{
          label:           'รายจ่ายสะสม',
          data:            data.map((d) => d.amount),
          borderColor:     isDarkMode ? '#4da2db' : '#2C6488',
          backgroundColor: gradient,
          borderWidth:     2,
          fill:            true,
          tension:         0.3,
          pointRadius:     1.5,
          pointHoverRadius: 4,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ฿${fmt(ctx.raw)}` } },
        },
        scales: {
          x: {
            grid:  { display: false },
            ticks: {
              font: { size: 9 },
              color: '#94a3b8',
              callback: function(val, index) {
                const total = data.length;
                if (total <= 12) {
                  return data[index].label;
                }
                return (index + 1) % 5 === 0 ? data[index].label : '';
              }
            },
          },
          y: {
            grid:  { color: isDarkMode ? '#24304c' : '#f1f5f9' },
            ticks: {
              font:     { size: 10 },
              color:    '#94a3b8',
              callback: (v) => v >= 1000 ? `฿${(v / 1000).toFixed(0)}K` : `฿${v}`,
            },
          },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data, isDarkMode]);

  return <div className="h-48"><canvas ref={canvasRef} /></div>;
}

function getTrendData(txs, period, weekStartDay) {
  if (!txs || txs.length === 0) return [];
  
  if (period === 'week' || period === 'today') {
    const days = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
    const dailySums = Array.from({ length: 7 }, (_, i) => {
      const d = (weekStartDay + i) % 7;
      return { label: days[d], amount: 0 };
    });
    
    txs.forEach((tx) => {
      if (tx.type === 'expense' && tx.transaction_date) {
        const d = new Date(tx.transaction_date);
        const wday = d.getDay();
        let index = (wday - weekStartDay) % 7;
        if (index < 0) index += 7;
        if (index >= 0 && index < 7) {
          dailySums[index].amount += Number(tx.amount || 0);
        }
      }
    });
    return dailySums;
  }
  
  if (period === 'month') {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const dailySums = Array.from({ length: daysInMonth }, (_, i) => ({
      label: `วันที่ ${i + 1}`,
      amount: 0,
    }));
    
    txs.forEach((tx) => {
      if (tx.type === 'expense' && tx.transaction_date) {
        const dateParts = tx.transaction_date.split('-');
        if (dateParts.length === 3) {
          const dayNum = parseInt(dateParts[2], 10);
          if (dayNum >= 1 && dayNum <= daysInMonth) {
            dailySums[dayNum - 1].amount += Number(tx.amount || 0);
          }
        }
      }
    });
    return dailySums;
  }

  if (period === 'year') {
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const monthlySums = Array.from({ length: 12 }, (_, i) => ({
      label: months[i],
      amount: 0,
    }));
    
    txs.forEach((tx) => {
      if (tx.type === 'expense' && tx.transaction_date) {
        const dateParts = tx.transaction_date.split('-');
        if (dateParts.length === 3) {
          const monthNum = parseInt(dateParts[1], 10);
          if (monthNum >= 1 && monthNum <= 12) {
            monthlySums[monthNum - 1].amount += Number(tx.amount || 0);
          }
        }
      }
    });
    return monthlySums;
  }
  
  return [];
}

// ─── Main component ───────────────────────────────────────────────────────────
function AccountCashflowBars({ data, totalIncome, totalExpense }) {
  if (data.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-50 mx-auto mb-3 flex items-center justify-center">
          <Wallet size={20} color="#cbd5e1" />
        </div>
        <p className="text-xs text-slate-400">ยังไม่มีรายรับหรือรายจ่ายในช่วงนี้</p>
      </div>
    );
  }

  const max = Math.max(...data.map((item) => Math.max(item.income, item.expense)), 1);

  return (
    <div className="space-y-4">
      {data.map((item) => {
        const incomeWidth = item.income > 0 ? Math.max((item.income / max) * 100, 6) : 0;
        const expenseWidth = item.expense > 0 ? Math.max((item.expense / max) * 100, 6) : 0;
        const incomePct = totalIncome > 0 ? (item.income / totalIncome) * 100 : 0;
        const expensePct = totalExpense > 0 ? (item.expense / totalExpense) * 100 : 0;

        return (
          <div key={item.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                  <Wallet size={15} color="#2C6488" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{item.name}</p>
                  <p className="text-[11px] text-slate-400">{item.count} รายการ</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-bold text-emerald-600">+฿{fmt(item.income)}</p>
                <p className="text-xs font-bold text-red-500">-฿{fmt(item.expense)}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-9 text-[10px] text-emerald-600 font-semibold">รับ</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${incomeWidth}%` }} />
                </div>
                <span className="w-8 text-right text-[10px] text-slate-400">{incomePct.toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-9 text-[10px] text-red-500 font-semibold">จ่าย</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${expenseWidth}%` }} />
                </div>
                <span className="w-8 text-right text-[10px] text-slate-400">{expensePct.toFixed(0)}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AnalyticsView({ accounts, categories, onGoProfile, onGoAccounts, isDarkMode }) {
  const [period,       setPeriod]       = useState('month');
  const [weekStartDay, setWeekStartDay] = useState(1); // 0=Sun 1=Mon 6=Sat
  const [periodStats,  setPeriodStats]  = useState({});   // { today:{inc,exp}, week:…, month:…, year:… }
  const [txList,       setTxList]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [barData,      setBarData]      = useState([]);
  const [aiPeriod,     setAiPeriod]     = useState('monthly');
  const [aiState,      setAiState]      = useState(null);
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiError,      setAiError]      = useState('');
  const [showAiSummary, setShowAiSummary] = useState(true);
  const [showAiSummaryModal, setShowAiSummaryModal] = useState(false);
  const [chartTab,     setChartTab]     = useState('compare'); // 'compare' or 'trend'

  // ── Fetch profile once ────────────────────────────────────────────────────
  useEffect(() => {
    profileApi.get()
      .then((p) => { if (p?.week_start_day !== undefined) setWeekStartDay(p.week_start_day); })
      .catch(() => {});
  }, []);

  // ── Fetch all periods' summary + selected period's detail + bar ───────────
  const fetchAll = useCallback(async (wsd) => {
    setLoading(true);
    try {
      // 1. Fetch all 4 period summaries in parallel
      const summaryResults = await Promise.all(
        PERIOD_CONFIG.map(async (pc) => {
          const { from, to } = getDateRange(pc.id, wsd);
          const r = await txApi.list({ date_from: from, date_to: to, limit: 500 });
          const data = r?.data || [];
          const inc  = data.filter((t) => t.type === 'income').reduce((s, t)  => s + t.amount, 0);
          const exp  = data.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
          return [pc.id, { inc, exp, data }];
        })
      );
      const stats = Object.fromEntries(summaryResults);
      setPeriodStats(stats);

      // 2. 6-month bar data
      const now  = new Date();
      const bars = [];
      for (let i = 5; i >= 0; i--) {
        const d  = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const yy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const f  = `${yy}-${mm}-01`;
        const l  = new Date(yy, d.getMonth() + 1, 0).getDate();
        const t  = `${yy}-${mm}-${pad(l)}`;
        const r  = await txApi.list({ date_from: f, date_to: t, limit: 500 });
        const ds = r?.data || [];
        const inc = ds.filter((x) => x.type === 'income').reduce((s, x)  => s + x.amount, 0);
        const exp = ds.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amount, 0);
        bars.push({ month: MONTH_LABELS[d.getMonth()], income: inc, expense: exp });
      }
      setBarData(bars);

      // 3. Set txList to initially selected period
      setPeriod((prev) => { setTxList(stats[prev]?.data || []); return prev; });
    } catch {
      setPeriodStats({});
      setTxList([]);
      setBarData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(weekStartDay); }, [weekStartDay, fetchAll]);

  const loadAiSummary = useCallback(async (periodType = aiPeriod) => {
    try {
      setAiError('');
      const data = await aiSummaryApi.get(periodType);
      setAiState(data);
    } catch (err) {
      setAiError(err.message || 'โหลดสรุป AI ไม่สำเร็จ');
    }
  }, [aiPeriod]);

  useEffect(() => { loadAiSummary(aiPeriod); }, [aiPeriod, weekStartDay, loadAiSummary]);

  const handleGenerateSummary = async (periodType = aiPeriod) => {
    setAiLoading(true);
    setAiError('');
    try {
      const data = await aiSummaryApi.generate(periodType);
      setAiState(data);
      setShowAiSummary(true);
    } catch (err) {
      setAiError(err.message || 'สรุปด้วย AI ไม่สำเร็จ');
      try {
        const data = await aiSummaryApi.get(periodType);
        setAiState(data);
      } catch {}
    } finally {
      setAiLoading(false);
    }
  };

  // When period tab changes, just swap txList from cached stats
  const handlePeriodSelect = (id) => {
    setPeriod(id);
    setTxList(periodStats[id]?.data || []);
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const totalAssets = accounts.filter((a) => a.type === 'asset').reduce((s, a)     => s + a.balance, 0);

  const income = txList.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txList.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const selectedPeriodLabel = PERIOD_CONFIG.find((p) => p.id === period)?.label || '';
  const spendRate = income > 0 ? Math.min((expense / income) * 100, 999) : 0;
  const cashflowByAccount = {};
  txList.filter((t) => t.type === 'income' || t.type === 'expense').forEach((t) => {
    const key = t.account_id || '__other__';
    if (!cashflowByAccount[key]) cashflowByAccount[key] = { income: 0, expense: 0, count: 0 };
    if (t.type === 'income') cashflowByAccount[key].income += Number(t.amount || 0);
    if (t.type === 'expense') cashflowByAccount[key].expense += Number(t.amount || 0);
    cashflowByAccount[key].count += 1;
  });
  const accountCashflowData = Object.entries(cashflowByAccount)
    .map(([id, item]) => {
      const account = accounts.find((a) => a.id === id);
      return {
        id,
        name: account?.name || 'ไม่ระบุบัญชี',
        income: item.income,
        expense: item.expense,
        count: item.count,
      };
    })
    .sort((a, b) => (b.income + b.expense) - (a.income + a.expense))
    .slice(0, 6);
  const recentTx = [...txList]
    .sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')))
    .slice(0, 5);
  const aiSummary = aiState?.summary;
  const hasAiSummary = !!aiSummary;
  const aiConsentEnabled = aiState?.ai_consent !== false;
  const showAiConsentNotice = aiState?.ai_consent === false;
  const showAiSummaryCard = aiConsentEnabled && hasAiSummary && showAiSummary;
  const overviewSpan = showAiSummaryCard ? 'lg:col-span-7' : 'lg:col-span-12';

  const currentRange = getDateRange(aiPeriod === 'weekly' ? 'week' : 'month', weekStartDay);
  const isFallback = aiState && hasAiSummary && (aiState.period_start !== currentRange.from || aiState.period_end !== currentRange.to);

  const getCatInfo = (id) => {
    const cat = id ? (categories || []).find((c) => c.id === id) : null;
    return {
      name: cat?.name || 'อื่นๆ',
      icon: cat?.icon || 'Tag',
      color: cat?.color || FALLBACK_CATEGORY_COLOR,
    };
  };

  const expByCat = {};
  txList.filter((t) => t.type === 'expense').forEach((t) => {
    const key = t.category_id || '__other__';
    expByCat[key] = (expByCat[key] || 0) + t.amount;
  });
  const donutData = Object.entries(expByCat)
    .map(([id, value]) => {
      const cat = getCatInfo(id === '__other__' ? null : id);
      return { label: cat.name, value, color: cat.color };
    })
    .sort((a, b) => b.value - a.value);

  const top5 = Object.entries(expByCat)
    .map(([id, value]) => {
      const cat = getCatInfo(id === '__other__' ? null : id);
      return {
        id,
        value,
        catName: cat.name,
        catIcon: cat.icon,
        catColor: cat.color,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return (
    <div className="p-6 space-y-5">

      {/* ── Overview ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4 items-start">
        <div className={`col-span-12 ${overviewSpan} rounded-2xl border border-[#DCE8EE] bg-gradient-to-br from-[#EAF3F7] to-[#d7e7ee] p-5 overflow-hidden min-h-[280px] flex flex-col gap-5`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold mb-2 text-[#2C6488]">ภาพรวมการเงิน</p>
              <h2 className="text-sm text-slate-500 mb-1">เงินทั้งหมด</h2>
              <p className="text-4xl font-bold text-[#2C6488]">
                ฿{fmt(totalAssets)}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                รวมยอดเงินจากทุกบัญชีที่ผู้ใช้สร้างไว้
              </p>
            </div>
            <button
              type="button"
              onClick={onGoAccounts}
              title="ไปหน้าบัญชี"
              className="w-12 h-12 rounded-2xl flex items-center justify-center border border-white bg-white/80 hover:bg-white hover:border-[#BFD8E4] transition-colors"
            >
              <Wallet size={24} color="#2C6488" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl p-4 border border-white bg-white/75">
              <p className="text-xs text-slate-500 mb-1">บัญชีทั้งหมด</p>
              <p className="text-lg font-bold text-[#2C6488]">{accounts.filter((a) => a.type === 'asset').length} บัญชี</p>
            </div>
            <div className="rounded-xl p-4 border border-white bg-white/75">
              <p className="text-xs text-slate-500 mb-1 truncate">รายรับ{selectedPeriodLabel}</p>
              <p className="text-lg font-bold text-emerald-600">฿{fmt(income)}</p>
            </div>
            <div className="rounded-xl p-4 border border-white bg-white/75">
              <p className="text-xs text-slate-500 mb-1 truncate">รายจ่าย{selectedPeriodLabel}</p>
              <p className="text-lg font-bold text-red-500">฿{fmt(expense)}</p>
            </div>
          </div>
          {showAiConsentNotice && (
            <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl px-4 py-3 border ${isDarkMode ? 'bg-[#1c2336] border-[#24304c]' : 'bg-white/85 border-[#BFD8E4] shadow-sm'}`}>
              <div>
                <p className={`text-sm font-semibold ${isDarkMode ? 'text-slate-200' : 'text-[#1f4358]'}`}>AI สรุปการเงินยังปิดอยู่</p>
                <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>
                  หากต้องการให้ระบบสรุปภาพรวมด้วย LLM ให้เปิดการยินยอมใช้ข้อมูลในหน้าโปรไฟล์ก่อน
                </p>
              </div>
              <button
                type="button"
                onClick={onGoProfile}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#2C6488] text-white text-xs font-semibold"
              >
                ไปเปิดที่โปรไฟล์
              </button>
            </div>
          )}
          {!showAiSummaryCard && !showAiConsentNotice && (
            <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl px-4 py-3 border ${isDarkMode ? 'bg-[#131926]/70 border-[#1e2638]' : 'bg-white/70 border-white'}`}>
              <div>
                <p className="text-sm font-semibold text-slate-700">AI สรุปการเงิน</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {hasAiSummary
                    ? 'มีสรุปที่สร้างไว้แล้ว กดเปิดเพื่อดูอีกครั้ง'
                    : aiState?.eligible === false
                    ? aiState.reason
                    : aiState?.stale
                      ? 'ข้อมูลมีการเปลี่ยนแปลง กดสรุปใหม่เพื่ออัปเดต'
                      : 'เลือกช่วงเวลาแล้วให้ AI ช่วยสรุปภาพรวมแบบสั้น ๆ'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`flex rounded-xl border p-1 ${isDarkMode ? 'bg-[#1a2235] border-[#24304c]' : 'bg-white border-[#DCE8EE]'}`}>
                  {[
                    ['weekly', 'สัปดาห์'],
                    ['monthly', 'เดือน'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAiPeriod(id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${aiPeriod === id ? 'bg-[#2C6488] text-white' : 'text-slate-500 hover:text-[#2C6488]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {hasAiSummary && (
                  <button
                    type="button"
                    onClick={() => setShowAiSummary(true)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${isDarkMode ? 'bg-[#1c2336] text-[#4da2db] border-[#24304c]' : 'bg-white text-[#2C6488] border-[#DCE8EE]'}`}
                  >
                    <Sparkles size={14} />
                    เปิดสรุป
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleGenerateSummary(aiPeriod)}
                  disabled={aiLoading || aiState?.eligible === false}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#2C6488] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {aiLoading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {aiState?.stale ? 'สรุปใหม่' : 'สรุปด้วย AI'}
                </button>
              </div>
            </div>
          )}
          {aiError && !hasAiSummary && (
            <p className="text-xs text-red-500">{aiError}</p>
          )}
        </div>

        {showAiSummaryCard && (
          <div className="col-span-12 lg:col-span-5 rounded-2xl bg-white p-5 shadow-sm border border-slate-100 min-h-[280px] max-h-[350px] flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Sparkles size={16} className="text-[#2C6488] flex-shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-700">AI สรุปการเงิน</h3>
                  {isFallback && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-600 border border-amber-200 animate-pulse">
                      รอบก่อนหน้า
                    </span>
                  )}
                </div>
                {aiState?.period_start && aiState?.period_end && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    ช่วงวันที่: {formatDisplayDateRange(aiState.period_start, aiState.period_end)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="flex rounded-xl bg-slate-50 border border-slate-100 p-1">
                  {[
                    ['weekly', 'สัปดาห์'],
                    ['monthly', 'เดือน'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAiPeriod(id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${aiPeriod === id ? 'bg-[#2C6488] text-white' : 'text-slate-500 hover:text-[#2C6488]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateSummary(aiPeriod)}
                  disabled={aiLoading || aiState?.eligible === false}
                  className="w-8 h-8 rounded-xl bg-[#EAF3F7] text-[#2C6488] inline-flex items-center justify-center disabled:opacity-50 hover:bg-[#DCE8EE]"
                  title={aiState?.stale ? 'สรุปใหม่' : 'รีเฟรชสรุป'}
                >
                  <RefreshCw size={15} className={aiLoading ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiSummaryModal(true)}
                  className="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 inline-flex items-center justify-center hover:bg-slate-100"
                  title="ขยายเต็มจอ"
                >
                  <Maximize2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiSummary(false)}
                  className="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 inline-flex items-center justify-center hover:bg-slate-100"
                  title="ปิดสรุป"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="rounded-xl bg-[#EAF3F7] border border-[#DCE8EE] px-3 py-3 mb-3">
                <p className="text-xs font-semibold text-[#2C6488] mb-1">{aiSummary.title || 'สรุปการเงิน'}</p>
                <p className="text-sm text-slate-700 leading-relaxed">{aiSummary.overview}</p>
              </div>

              <div className="space-y-4">
                {aiSummary.highlights?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2C6488]" />
                      ประเด็นสำคัญ
                    </p>
                    <div className="space-y-2 pl-3">
                      {aiSummary.highlights.slice(0, 4).map((item, idx) => (
                        <p key={idx} className="text-xs text-slate-600 leading-relaxed relative before:content-['•'] before:absolute before:-left-3 before:text-[#2C6488]">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {aiSummary.cautions?.length > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                      <AlertCircle size={12} className="text-amber-600 flex-shrink-0" />
                      ข้อควรระวัง
                    </p>
                    <div className="space-y-1.5 pl-1">
                      {aiSummary.cautions.slice(0, 3).map((item, idx) => (
                        <p key={idx} className="text-xs text-amber-700 leading-relaxed">• {item}</p>
                      ))}
                    </div>
                  </div>
                )}
                {aiSummary.suggestions?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      คำแนะนำเพื่อการออมเงิน
                    </p>
                    <div className="space-y-2.5 pl-1">
                      {aiSummary.suggestions.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
                          <span className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-[9px]">
                            {idx + 1}
                          </span>
                          <p className="flex-1">{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {aiState?.stale && (
                <p className="mt-3 text-xs text-amber-600">ข้อมูลมีการเปลี่ยนแปลง กดรีเฟรชเพื่อสรุปใหม่</p>
              )}
              {aiError && (
                <p className="mt-3 text-xs text-red-500">{aiError}</p>
              )}

              <p className="mt-5 text-[10px] text-slate-400 italic text-center border-t border-slate-100 pt-3">
                *คำแนะนำนี้เป็นคำแนะนำเบื้องต้นจาก AI*
              </p>
            </div>
          </div>
        )}

        {false && hasAiSummary && (
          <div className="col-span-12 lg:col-span-5 rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} color="#2C6488" />
            <h3 className="text-sm font-semibold text-slate-700">วันนี้ควรรู้</h3>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl bg-slate-50 px-3 py-3">
              <p className="text-xs text-slate-400 mb-1">{selectedPeriodLabel} ใช้ไปเทียบกับรายรับ</p>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(spendRate, 100)}%`, background: spendRate > 100 ? '#ef4444' : '#2C6488' }} />
                </div>
                <span className={`text-xs font-bold ${spendRate > 100 ? 'text-red-500' : 'text-[#2C6488]'}`}>
                  {income > 0 ? `${spendRate.toFixed(0)}%` : 'ไม่มีรายรับ'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-emerald-50 px-3 py-3">
                <p className="text-xs text-slate-500 mb-1">รายรับ</p>
                <p className="text-sm font-bold text-emerald-600">+฿{fmt(income)}</p>
              </div>
              <div className="rounded-xl bg-red-50 px-3 py-3">
                <p className="text-xs text-slate-500 mb-1">รายจ่าย</p>
                <p className="text-sm font-bold text-red-500">-฿{fmt(expense)}</p>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* ── Period Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PERIOD_CONFIG.map((pc) => {
          const stats    = periodStats[pc.id];
          const active   = period === pc.id;
          const dateLabel = periodDateLabel(pc.id, weekStartDay);

          return (
            <button
              key={pc.id}
              onClick={() => handlePeriodSelect(pc.id)}
              className={`rounded-2xl p-4 text-left transition-all border-2 ${
                active
                  ? 'shadow-md scale-[1.02]'
                  : 'hover:shadow-sm hover:scale-[1.01]'
              }`}
              style={{
                background:   active ? (isDarkMode ? '#152438' : pc.bg)  : (isDarkMode ? '#131926' : '#ffffff'),
                borderColor:  active ? (isDarkMode ? '#2c6488' : pc.ring) : (isDarkMode ? '#24304c' : '#f1f5f9'),
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                    style={{ background: isDarkMode ? '#1a2c44' : pc.bg }}>
                    {pc.icon === 'Sun' && <Sun size={14} color={isDarkMode ? '#4da2db' : pc.color} />}
                    {pc.icon === 'Calendar' && <Calendar size={14} color={isDarkMode ? '#4da2db' : pc.color} />}
                    {pc.icon === 'BarChart2' && <BarChart2 size={14} color={isDarkMode ? '#4da2db' : pc.color} />}
                    {pc.icon === 'TrendingUp' && <TrendingUp size={14} color={isDarkMode ? '#4da2db' : pc.color} />}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: isDarkMode ? '#4da2db' : pc.color }}>{pc.label}</span>
                </div>
                {active && (
                  <div className="w-2 h-2 rounded-full" style={{ background: isDarkMode ? '#4da2db' : pc.color }} />
                )}
              </div>

              {/* Date range */}
              <p className="text-xs text-slate-400 mb-3 leading-relaxed">{dateLabel}</p>

              {/* Income / Expense */}
              {loading || !stats ? (
                <div className="space-y-1.5">
                  <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-3/4" />
                  <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-2/3" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs text-slate-500">รายรับ</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-600">+฿{fmt(stats.inc)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-xs text-slate-500">รายจ่าย</span>
                    </div>
                    <span className="text-xs font-bold text-red-500">-฿{fmt(stats.exp)}</span>
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Donut */}
            <div className="col-span-1 lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">รายจ่ายตามหมวด</h3>
              <p className="text-xs text-slate-400 mb-3">
                {PERIOD_CONFIG.find((p) => p.id === period)?.label}
                {' · '}฿{fmt(expense)}
              </p>
              {donutData.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">ไม่มีรายจ่าย</div>
              ) : (
                <div className="flex items-start gap-4">
                  <DonutChart data={donutData} isDarkMode={isDarkMode} />
                  <div className="flex-1 space-y-2 mt-1">
                    {donutData.slice(0, 6).map((d, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: d.color || FALLBACK_CATEGORY_COLOR }} />
                          <span className="text-xs text-slate-600 truncate">{d.label}</span>
                        </div>
                        <span className="text-xs font-medium text-slate-700 flex-shrink-0">฿{fmt(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Bar & Line Chart Container */}
            <div className="col-span-1 lg:col-span-3 bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setChartTab('compare')}
                      className={`text-sm font-bold pb-1 border-b-2 transition-all ${
                        chartTab === 'compare'
                          ? 'border-[#2C6488] text-[#2C6488]'
                          : 'border-transparent text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      รายรับ vs รายจ่าย (6 เดือน)
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartTab('trend')}
                      className={`text-sm font-bold pb-1 border-b-2 transition-all ${
                        chartTab === 'trend'
                          ? 'border-[#2C6488] text-[#2C6488]'
                          : 'border-transparent text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      แนวโน้มรายจ่าย ({selectedPeriodLabel})
                    </button>
                  </div>
                  {chartTab === 'compare' ? (
                    <div className="flex gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full" style={{ background: '#34d399' }} />
                        <span className="text-slate-500">รายรับ</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full" style={{ background: '#fb7185' }} />
                        <span className="text-slate-500">รายจ่าย</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs font-semibold text-slate-500">
                      เฉลี่ยรายจ่ายต่อวัน: ฿{fmt(expense / (getTrendData(txList, period, weekStartDay).length || 1))}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  {chartTab === 'compare'
                    ? 'สถิติสรุปข้อมูลรายรับและรายจ่าย 6 เดือนที่ผ่านมา'
                    : `การแจกแจงรายจ่ายสะสมในแต่ละวันในช่วง${selectedPeriodLabel} (รวม ฿${fmt(expense)})`}
                </p>
              </div>

              {chartTab === 'compare' ? (
                <BarChart data={barData} isDarkMode={isDarkMode} />
              ) : (
                <LineChart data={getTrendData(txList, period, weekStartDay)} isDarkMode={isDarkMode} />
              )}

            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">รายการล่าสุด</h3>
                <ReceiptText size={16} color="#94a3b8" />
              </div>
              {recentTx.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">ยังไม่มีรายการในช่วงนี้</div>
              ) : (
                <div className="space-y-3">
                  {recentTx.map((tx) => {
                    const cat = (categories || []).find((c) => c.id === tx.category_id);
                    return (
                      <div key={tx.id} className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: isDarkMode ? (tx.type === 'income' ? '#152920' : tx.type === 'expense' ? '#2a1b1d' : '#152438') : (tx.type === 'income' ? '#f0fdf4' : tx.type === 'expense' ? '#fff1f2' : '#EAF3F7') }}>
                          <Icon name={cat?.icon || 'Tag'} size={16} color={tx.type === 'income' ? '#10b981' : tx.type === 'expense' ? '#ef4444' : (isDarkMode ? '#4da2db' : '#2C6488')} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{tx.name || tx.note || 'ไม่มีชื่อรายการ'}</p>
                          <p className="text-xs text-slate-400">{formatDisplayDate(tx.transaction_date, '')}</p>
                        </div>
                        <p className={`text-sm font-bold ${tx.type === 'expense' ? 'text-red-500' : 'text-emerald-600'}`}>
                          {tx.type === 'expense' ? '-' : '+'}฿{fmt(tx.amount)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">รายรับรายจ่ายตามบัญชี</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedPeriodLabel} · รับ ฿{fmt(income)} · จ่าย ฿{fmt(expense)}
                  </p>
                </div>
                <Wallet size={16} color="#94a3b8" />
              </div>
              <AccountCashflowBars data={accountCashflowData} totalIncome={income} totalExpense={expense} />
            </div>
          </div>

          {/* Top 5 */}
          {top5.length > 0 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">
                Top 5 รายจ่ายสูงสุด
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {PERIOD_CONFIG.find((p) => p.id === period)?.label}
                {' · '}{periodDateLabel(period, weekStartDay)}
              </p>
              <div className="space-y-3">
                {top5.map((item, i) => {
                  const pct = (item.value / top5[0].value) * 100;
                  return (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className="w-6 text-center text-xs font-bold text-slate-400">#{i + 1}</div>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `${item.catColor || FALLBACK_CATEGORY_COLOR}20` }}>
                        <Icon name={item.catIcon} size={16} color={item.catColor || FALLBACK_CATEGORY_COLOR} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-medium text-slate-700">{item.catName}</p>
                          <p className="text-xs font-bold text-slate-800 ml-2">฿{fmt(item.value)}</p>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: item.catColor || FALLBACK_CATEGORY_COLOR }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* AI Summary Full Screen Modal */}
      {showAiSummaryModal && hasAiSummary && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full max-h-[85vh] flex flex-col p-6 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-4 mb-4 flex-shrink-0">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Sparkles size={18} className="text-[#2C6488]" />
                  <h2 className="text-base font-bold text-slate-800">สรุปการเงินอัจฉริยะ</h2>
                  {isFallback && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 border border-amber-200">
                      รอบก่อนหน้า
                    </span>
                  )}
                </div>
                {aiState?.period_start && aiState?.period_end && (
                  <p className="text-xs text-slate-400 mt-1">
                    ช่วงวันที่วิเคราะห์: {formatDisplayDateRange(aiState.period_start, aiState.period_end)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAiSummaryModal(false)}
                className="w-9 h-9 rounded-xl bg-slate-50 text-slate-500 inline-flex items-center justify-center hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-5">
              <div className="rounded-2xl bg-[#EAF3F7] border border-[#DCE8EE] p-4">
                <h4 className="text-sm font-bold text-[#2C6488] mb-1.5">{aiSummary.title || 'สรุปการเงิน'}</h4>
                <p className="text-sm text-slate-700 leading-relaxed">{aiSummary.overview}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {aiSummary.highlights?.length > 0 && (
                  <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                    <h4 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#2C6488]" />
                      ประเด็นสำคัญ
                    </h4>
                    <div className="space-y-2.5 pl-3">
                      {aiSummary.highlights.map((item, idx) => (
                        <p key={idx} className="text-xs text-slate-600 leading-relaxed relative before:content-['•'] before:absolute before:-left-3 before:text-[#2C6488]">
                          {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {aiSummary.cautions?.length > 0 && (
                  <div className="bg-amber-50/50 rounded-2xl p-4 border border-amber-100">
                    <h4 className="text-xs font-bold text-amber-800 mb-3 flex items-center gap-1.5">
                      <AlertCircle size={14} className="text-amber-600" />
                      ข้อควรระวัง
                    </h4>
                    <div className="space-y-2 pl-1">
                      {aiSummary.cautions.map((item, idx) => (
                        <p key={idx} className="text-xs text-amber-700 leading-relaxed">• {item}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {aiSummary.suggestions?.length > 0 && (
                <div className="bg-white rounded-2xl p-4 border border-slate-100">
                  <h4 className="text-xs font-bold text-slate-500 mb-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    คำแนะนำเพื่อการวางแผนการเงิน
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-1">
                    {aiSummary.suggestions.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-slate-600 leading-relaxed">
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

            {/* Modal Footer */}
            <div className="border-t border-slate-100 pt-3 mt-4 flex items-center justify-between flex-shrink-0">
              <p className="text-[10px] text-slate-400 italic">
                *คำแนะนำนี้เป็นคำแนะนำเบื้องต้นจาก AI*
              </p>
              <button
                type="button"
                onClick={() => setShowAiSummaryModal(false)}
                className="px-4 py-2 rounded-xl bg-[#2C6488] text-white text-xs font-semibold hover:bg-[#204a66]"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
