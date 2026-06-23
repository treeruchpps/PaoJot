import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Sun, Calendar, BarChart2, TrendingUp, Wallet, AlertCircle, Sparkles, X, Maximize2, Target, ChevronRight } from 'lucide-react';
import { transactions as txApi, profile as profileApi, savingsGoals as goalsApi, budgets as budgetsApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDateRange } from '../utils/dateFormat';
import { getCategoryStyle } from '../constants/categoryStyles';

// ─── Constants ───────────────────────────────────────────────────────────────
const MONTH_LABELS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const FULL_MONTH_LABELS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const FALLBACK_CATEGORY_COLOR = '#94a3b8';
const SAVING_COLOR = '#0EA5E9';
const CHART_FONT_FAMILY = "'Sarabun', sans-serif";

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
            backgroundColor: 'rgba(16, 185, 129, 0.75)',
            hoverBackgroundColor: '#10b981',
            borderRadius:    8,
            borderSkipped:   false,
            barPercentage:   0.64,
            categoryPercentage: 0.62,
            maxBarThickness: 22,
          },
          {
            label:           'รายจ่าย',
            data:            data.map((d) => d.expense),
            backgroundColor: 'rgba(244, 63, 94, 0.72)',
            hoverBackgroundColor: '#f43f5e',
            borderRadius:    8,
            borderSkipped:   false,
            barPercentage:   0.64,
            categoryPercentage: 0.62,
            maxBarThickness: 22,
          },
          {
            label:           'การออม',
            data:            data.map((d) => d.saving),
            backgroundColor: 'rgba(14, 165, 233, 0.72)',
            hoverBackgroundColor: SAVING_COLOR,
            borderRadius:    8,
            borderSkipped:   false,
            barPercentage:   0.64,
            categoryPercentage: 0.62,
            maxBarThickness: 22,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins: {
          legend:  { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            padding: 10,
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            titleFont: { family: CHART_FONT_FAMILY, size: 12, weight: 600 },
            bodyFont: { family: CHART_FONT_FAMILY, size: 12 },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ฿${fmt(ctx.raw)}` },
          },
        },
        scales: {
          x: {
            grid:  { display: false },
            border: { display: false },
            ticks: { font: { family: CHART_FONT_FAMILY, size: 11, weight: 600 }, color: isDarkMode ? '#9ca3af' : '#111827' },
          },
          y: {
            border: { display: false },
            grid:  { color: isDarkMode ? '#24304c' : '#eef4f7', drawTicks: false },
            ticks: {
              font:     { family: CHART_FONT_FAMILY, size: 11 },
              color:    isDarkMode ? '#9ca3af' : '#4b5563',
              padding:   8,
              callback: (v) => v >= 1000 ? `฿${(v / 1000).toFixed(0)}K` : `฿${v}`,
            },
          },
        },
      },
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data, isDarkMode]);

  return <div className="h-56"><canvas ref={canvasRef} /></div>;
}

// ─── Chart: Line (Spending Trend) ──────────────────────────────────────────
function TrendLineChart({ data, isDarkMode }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    const C = window.Chart;
    if (!canvasRef.current || !C) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const ctx = canvasRef.current.getContext('2d');
    const incomeGradient = ctx.createLinearGradient(0, 0, 0, 260);
    incomeGradient.addColorStop(0, 'rgba(52, 211, 153, 0.18)');
    incomeGradient.addColorStop(1, 'rgba(52, 211, 153, 0.02)');
    const savingGradient = ctx.createLinearGradient(0, 0, 0, 260);
    savingGradient.addColorStop(0, 'rgba(14, 165, 233, 0.16)');
    savingGradient.addColorStop(1, 'rgba(14, 165, 233, 0.02)');
    const expenseGradient = ctx.createLinearGradient(0, 0, 0, 260);
    expenseGradient.addColorStop(0, 'rgba(251, 113, 133, 0.16)');
    expenseGradient.addColorStop(1, 'rgba(251, 113, 133, 0.02)');

    const crosshairPlugin = {
      id: 'crosshair',
      afterDraw(chart) {
        const active = (chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements()) || [];
        if (!active.length) return;
        const x = active[0].element.x;
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.beginPath();
        c.setLineDash([5, 5]);
        c.moveTo(x, top);
        c.lineTo(x, bottom);
        c.lineWidth = 1;
        c.strokeStyle = isDarkMode ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.45)';
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.arc(x, top, 9, 0, Math.PI * 2);
        c.fillStyle = isDarkMode ? '#0b0f19' : '#ffffff';
        c.fill();
        c.lineWidth = 2.5;
        c.strokeStyle = isDarkMode ? '#e5e7eb' : '#1f2937';
        c.stroke();
        c.restore();
      },
    };

    chartRef.current = new C(canvasRef.current, {
      type: 'line',
      data: {
        labels:   data.map((d) => d.month),
        datasets: [
          {
            label: 'รายรับ',
            data: data.map((d) => d.income),
            borderColor: '#34c986',
            backgroundColor: incomeGradient,
            borderWidth: 3,
            fill: true,
            tension: 0.42,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 14,
          },
          {
            label: 'รายจ่าย',
            data: data.map((d) => d.expense),
            borderColor: '#fb7185',
            backgroundColor: expenseGradient,
            borderWidth: 3,
            fill: true,
            tension: 0.42,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 14,
          },
          {
            label: 'การออม',
            data: data.map((d) => d.saving),
            borderColor: SAVING_COLOR,
            backgroundColor: savingGradient,
            borderWidth: 3,
            fill: true,
            tension: 0.42,
            pointRadius: 0,
            pointHoverRadius: 0,
            pointHitRadius: 14,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        layout: { padding: { top: 14 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend:  { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            padding: 10,
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            titleFont: { family: CHART_FONT_FAMILY, size: 12, weight: 600 },
            bodyFont: { family: CHART_FONT_FAMILY, size: 12 },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ฿${fmt(ctx.raw)}` },
          },
        },
        scales: {
          x: {
            grid:  { display: false },
            border: { display: false },
            ticks: {
              font: { family: CHART_FONT_FAMILY, size: 11, weight: 600 },
              color: isDarkMode ? '#9ca3af' : '#111827',
            },
          },
          y: {
            border: { display: false },
            grid:  {
              color: isDarkMode ? '#24304c' : '#e5e7eb',
              borderDash: [4, 4],
              drawTicks: false,
            },
            ticks: {
              font:     { family: CHART_FONT_FAMILY, size: 12 },
              color:    isDarkMode ? '#9ca3af' : '#4b5563',
              padding:   10,
              callback: (v) => v >= 1000 ? `฿${Math.round(v / 1000)}k` : `฿${v === 0 ? '0k' : v}`,
            },
          },
        },
      },
      plugins: [crosshairPlugin],
    });

    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [data, isDarkMode]);

  return <div className="h-56"><canvas ref={canvasRef} /></div>;
}

function savingActivityAmount(tx, savingAccountIds) {
  const amount = Number(tx?.amount || 0);
  if (tx?.type === 'goal_deposit') return amount;
  if (tx?.type === 'goal_withdrawal') return -amount;
  if (tx?.type === 'transfer' && tx.to_account_id && savingAccountIds.has(tx.to_account_id)) return amount;
  return 0;
}

function signedBaht(value, positivePrefix = '+') {
  const amount = Number(value || 0);
  if (amount < 0) return `−฿${fmt(Math.abs(amount))}`;
  if (amount > 0) return `${positivePrefix}฿${fmt(amount)}`;
  return `฿${fmt(0)}`;
}

function getYearCashflowTrend(txs, savingAccountIds) {
  const monthly = MONTH_LABELS.map((month) => ({ month, income: 0, expense: 0, saving: 0 }));
  (txs || []).forEach((tx) => {
    if (!tx.transaction_date) return;
    const dateParts = tx.transaction_date.split('-');
    if (dateParts.length !== 3) return;
    const monthIndex = parseInt(dateParts[1], 10) - 1;
    if (monthIndex < 0 || monthIndex > 11) return;
    if (tx.type === 'income') monthly[monthIndex].income += Number(tx.amount || 0);
    if (tx.type === 'expense') monthly[monthIndex].expense += Number(tx.amount || 0);
    monthly[monthIndex].saving += savingActivityAmount(tx, savingAccountIds);
  });
  return monthly;
}

async function fetchDashboardTransactions(params = {}) {
  const [normal, deposits, withdrawals] = await Promise.all([
    txApi.list(params),
    txApi.list({ ...params, type: 'goal_deposit' }),
    txApi.list({ ...params, type: 'goal_withdrawal' }),
  ]);
  return [
    ...(normal?.data || []),
    ...(deposits?.data || []),
    ...(withdrawals?.data || []),
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────


export default function AnalyticsView({ accounts, categories, onGoProfile, onGoAccounts, onGoBudgets, onGoGoals, isDarkMode, quickEntryRefreshKey = 0 }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [donutMonth,   setDonutMonth]   = useState(0); // 0 = ทั้งปี, 1-12 = เดือน
  const [weekStartDay, setWeekStartDay] = useState(1); // 0=Sun 1=Mon 6=Sat
  const [periodStats,  setPeriodStats]  = useState({});   // { today:{inc,exp}, week:…, month:…, year:… }
  const [allTxList,    setAllTxList]    = useState([]);
  const [goals,        setGoals]        = useState([]);
  const [budgets,      setBudgets]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [aiPeriod,     setAiPeriod]     = useState('monthly');
  const [aiState]      = useState(null);
  const [aiError]      = useState('');
  const [showAiSummaryModal, setShowAiSummaryModal] = useState(false);
  const [chartTab,     setChartTab]     = useState('trend'); // 'compare' or 'trend'
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
      const goalsList = await goalsApi.list();
      const activeGoals = (goalsList || []).filter((goal) => goal.status !== 'cancelled');
      const savingAccountIds = new Set(activeGoals.map((goal) => goal.account_id).filter(Boolean));
      setGoals(activeGoals);
      const budgetsList = await budgetsApi.list().catch(() => []);
      setBudgets(budgetsList || []);

      // 1. Fetch all 4 period summaries in parallel
      const summaryResults = await Promise.all(
        PERIOD_CONFIG.map(async (pc) => {
          const { from, to } = getDateRange(pc.id, wsd);
          const data = await fetchDashboardTransactions({ date_from: from, date_to: to, limit: 10000 });
          const inc  = data.filter((t) => t.type === 'income').reduce((s, t)  => s + t.amount, 0);
          const exp  = data.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
          const sav  = data.reduce((s, t) => s + savingActivityAmount(t, savingAccountIds), 0);
          return [pc.id, { inc, exp, sav, data }];
        })
      );
      const stats = Object.fromEntries(summaryResults);
      setPeriodStats(stats);

      const allData = await fetchDashboardTransactions({ limit: 10000 });
      setAllTxList(allData);
    } catch {
      setPeriodStats({});
      setAllTxList([]);
      setGoals([]);
      setBudgets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(weekStartDay); }, [weekStartDay, quickEntryRefreshKey, fetchAll]);

  // AI summary is now surfaced in the chat page through AI notifications.


  // ── Computed ──────────────────────────────────────────────────────────────
  const totalAssets = accounts.filter((a) => a.type === 'asset').reduce((s, a)     => s + a.balance, 0);
  const activeSavingAccountIds = new Set((goals || []).map((goal) => goal.account_id).filter(Boolean));

  // ── Year-scoped data (drives overview + all charts) ──────────────────────
  const availableYears = (() => {
    const years = new Set([currentYear]);
    (allTxList || []).forEach((t) => {
      if (t.transaction_date) {
        const y = parseInt(t.transaction_date.slice(0, 4), 10);
        if (y) years.add(y);
      }
    });
    return Array.from(years).sort((a, b) => b - a);
  })();
  const yearTx = (allTxList || []).filter(
    (t) => t.transaction_date && t.transaction_date.slice(0, 4) === String(selectedYear)
  );
  const yearIncome = yearTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const yearExpense = yearTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const yearSaving = yearTx.reduce((s, t) => s + savingActivityAmount(t, activeSavingAccountIds), 0);
  const yearNetCashflow = totalAssets;
  const yearMonthly = getYearCashflowTrend(yearTx, activeSavingAccountIds);
  const barData = yearMonthly;
  const yearTrendData = yearMonthly;
  const barIncomeTotal = yearIncome;
  const barExpenseTotal = yearExpense;
  const barSavingTotal = yearSaving;
  const donutTx = donutMonth === 0
    ? yearTx
    : yearTx.filter((t) => parseInt((t.transaction_date || '').slice(5, 7), 10) === donutMonth);
  const donutExpense = donutTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const donutPeriodLabel = donutMonth === 0
    ? `ทั้งปี ${selectedYear}`
    : `${MONTH_LABELS[donutMonth - 1]} ${selectedYear}`;
  const aiSummary = aiState?.summary;
  const hasAiSummary = !!aiSummary;
  const showAiSummaryCard = false;

  const currentRange = getDateRange(aiPeriod === 'weekly' ? 'week' : 'month', weekStartDay);
  const isFallback = aiState && hasAiSummary && (aiState.period_start !== currentRange.from || aiState.period_end !== currentRange.to);

  const getCatInfo = (id) => {
    const cat = id ? (categories || []).find((c) => c.id === id) : null;
    const style = getCategoryStyle(cat);
    return {
      name: cat?.name || 'อื่นๆ',
      icon: style.icon,
      color: style.color,
    };
  };

  const expByCat = {};
  donutTx.filter((t) => t.type === 'expense').forEach((t) => {
    const key = t.category_id || '__other__';
    expByCat[key] = (expByCat[key] || 0) + t.amount;
  });
  const donutData = Object.entries(expByCat)
    .map(([id, value]) => {
      const cat = getCatInfo(id === '__other__' ? null : id);
      return { label: cat.name, value, color: cat.color };
    })
    .sort((a, b) => b.value - a.value);
  const dashToday = new Date().toISOString().slice(0, 10);
  const activeBudgets = (budgets || [])
    .filter((b) => b.is_active && (!b.end_date || b.end_date >= dashToday))
    .map((b) => {
      const limit = Number(b.amount || 0);
      const spent = Number(b.spent || 0);
      const pct = limit > 0 ? (spent / limit) * 100 : 0;
      return { ...b, limit, spent, pct };
    })
    .sort((a, b) => b.pct - a.pct);
  const topBudgets = activeBudgets.slice(0, 4);
  const budgetTotalLimit = activeBudgets.reduce((s, b) => s + b.limit, 0);
  const budgetTotalSpent = activeBudgets.reduce((s, b) => s + b.spent, 0);
  const budgetTotalPct = budgetTotalLimit > 0 ? Math.min(999, Math.round((budgetTotalSpent / budgetTotalLimit) * 100)) : 0;
  const inProgressGoals = (goals || [])
    .filter((g) => g.status === 'in_progress')
    .map((g) => {
      const target = Number(g.target_amount || 0);
      const current = Number(g.current_amount || 0);
      const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
      return { ...g, target, current, pct, remaining: Math.max(0, target - current) };
    })
    .sort((a, b) => b.pct - a.pct);
  const topGoals = inProgressGoals.slice(0, 3);
  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* ── Overview ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4 items-start">
        <div className="col-span-12 rounded-2xl border border-[#DCE8EE] bg-gradient-to-br from-[#EAF3F7] to-[#d7e7ee] p-5 overflow-hidden flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold mb-2 text-[#2C6488]">ภาพรวมการเงิน</p>
              <h2 className="text-sm text-slate-500 mb-1">กระแสเงินสุทธิรวม</h2>
              <p className="text-4xl font-bold whitespace-nowrap" style={{ color: yearNetCashflow >= 0 ? '#15803d' : '#dc2626' }}>
                {signedBaht(yearNetCashflow, '')}
              </p>
              <p className="text-xs text-slate-400 mt-2">
                สินทรัพย์จากบัญชี ฿{fmt(totalAssets)} · {accounts.filter((a) => a.type === 'asset').length} บัญชี
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                title="เลือกปี"
                className="h-10 rounded-xl border border-white bg-white/80 px-3 text-sm font-semibold text-[#2C6488] outline-none hover:bg-white focus:border-[#BFD8E4] cursor-pointer"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>ปี {y}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={onGoAccounts}
                title="ไปหน้าบัญชี"
                className="w-10 h-10 rounded-2xl flex items-center justify-center border border-white bg-white/80 hover:bg-white hover:border-[#BFD8E4] transition-colors flex-shrink-0"
              >
                <Wallet size={20} color="#2C6488" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl p-3 sm:p-4 border border-white bg-white/75 flex items-center justify-between gap-2 sm:block">
              <p className="text-xs text-slate-500 sm:mb-1 truncate">รายรับ ปี {selectedYear}</p>
              <p className="text-base sm:text-lg font-bold text-emerald-600 whitespace-nowrap flex-shrink-0">฿{fmt(yearIncome)}</p>
            </div>
            <div className="rounded-xl p-3 sm:p-4 border border-white bg-white/75 flex items-center justify-between gap-2 sm:block">
              <p className="text-xs text-slate-500 sm:mb-1 truncate">รายจ่าย ปี {selectedYear}</p>
              <p className="text-base sm:text-lg font-bold text-red-500 whitespace-nowrap flex-shrink-0">฿{fmt(yearExpense)}</p>
            </div>
            <div className="rounded-xl p-3 sm:p-4 border border-white bg-white/75 flex items-center justify-between gap-2 sm:block">
              <p className="text-xs text-slate-500 sm:mb-1 truncate">การออม ปี {selectedYear}</p>
              <p className="text-base sm:text-lg font-bold whitespace-nowrap flex-shrink-0" style={{ color: SAVING_COLOR }}>฿{fmt(yearSaving)}</p>
            </div>
          </div>
        </div>

      </div>

        {showAiSummaryCard && (
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100 flex flex-col max-h-[440px]">
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
                  onClick={() => setShowAiSummaryModal(true)}
                  className="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 inline-flex items-center justify-center hover:bg-slate-100"
                  title="ขยายเต็มจอ"
                >
                  <Maximize2 size={15} />
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

      {/* ── Period Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PERIOD_CONFIG.map((pc) => {
          const stats    = periodStats[pc.id];
          const dateLabel = periodDateLabel(pc.id, weekStartDay);

          return (
            <div
              key={pc.id}
              className="rounded-xl p-3 text-left border shadow-sm"
              style={{
                background:   isDarkMode ? '#131926' : '#ffffff',
                borderColor:  isDarkMode ? '#24304c' : '#f1f5f9',
              }}
            >
              {/* Phone: compact list row */}
              <div className="flex sm:hidden items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: isDarkMode ? '#1a2c44' : pc.bg }}>
                  {pc.icon === 'Sun' && <Sun size={16} color={isDarkMode ? '#4da2db' : pc.color} />}
                  {pc.icon === 'Calendar' && <Calendar size={16} color={isDarkMode ? '#4da2db' : pc.color} />}
                  {pc.icon === 'BarChart2' && <BarChart2 size={16} color={isDarkMode ? '#4da2db' : pc.color} />}
                  {pc.icon === 'TrendingUp' && <TrendingUp size={16} color={isDarkMode ? '#4da2db' : pc.color} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight" style={{ color: isDarkMode ? '#4da2db' : pc.color }}>{pc.label}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">{dateLabel}</p>
                </div>
                {loading || !stats ? (
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <div className="h-3 w-12 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3 w-10 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3 w-9 bg-slate-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <div className="text-right leading-tight flex-shrink-0">
                    <p className="text-xs font-bold text-emerald-600">{signedBaht(stats.inc)}</p>
                    <p className="text-xs font-bold text-red-500">-฿{fmt(stats.exp)}</p>
                    <p className="text-xs font-bold" style={{ color: SAVING_COLOR }}>฿{fmt(stats.sav || 0)}</p>
                  </div>
                )}
              </div>

              <div className="hidden sm:block">
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
              </div>

              {/* Date range */}
              <p className="text-xs text-slate-400 mb-3 leading-relaxed">{dateLabel}</p>

              {/* Income / Expense */}
              {loading || !stats ? (
                <div className="space-y-1.5">
                  <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-3/4" />
                  <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-2/3" />
                  <div className="h-4 bg-slate-100 rounded-lg animate-pulse w-1/2" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-xs text-slate-500">รายรับ</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-600">{signedBaht(stats.inc)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                      <span className="text-xs text-slate-500">รายจ่าย</span>
                    </div>
                    <span className="text-xs font-bold text-red-500">-฿{fmt(stats.exp)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: SAVING_COLOR }} />
                      <span className="text-xs text-slate-500">การออม</span>
                    </div>
                    <span className="text-xs font-bold" style={{ color: SAVING_COLOR }}>฿{fmt(stats.sav || 0)}</span>
                  </div>
                </div>
              )}
              </div>
            </div>
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
            <div className="col-span-1 lg:col-span-2 order-2 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-1">รายจ่ายตามหมวด</h3>
                  <p className="text-xs text-slate-400">
                    {donutPeriodLabel}
                    {' · '}฿{fmt(donutExpense)}
                  </p>
                </div>
                <select
                  value={donutMonth}
                  onChange={(e) => setDonutMonth(Number(e.target.value))}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 outline-none focus:border-[#2C6488] focus:ring-2 focus:ring-[#EAF3F7]"
                >
                  <option value={0}>ทั้งปี</option>
                  {MONTH_LABELS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
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
            <div className="col-span-1 lg:col-span-3 order-1 bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">แนวโน้มการเงิน</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {chartTab === 'compare'
                        ? `เปรียบเทียบรายเดือน ปี ${selectedYear}`
                        : `รายรับ รายจ่าย และการออมรายเดือน ปี ${selectedYear}`}
                    </p>
                  </div>
                  <div className="flex rounded-xl bg-slate-50 border border-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setChartTab('trend')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        chartTab === 'trend'
                          ? 'bg-white text-[#2C6488] shadow-sm'
                          : 'text-slate-500 hover:text-[#2C6488]'
                      }`}
                    >
                      แนวโน้ม
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartTab('compare')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        chartTab === 'compare'
                          ? 'bg-white text-[#2C6488] shadow-sm'
                          : 'text-slate-500 hover:text-[#2C6488]'
                      }`}
                    >
                      รายเดือน
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  {chartTab === 'compare' ? (
                    <div className="flex gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} />
                        <span className="text-slate-500">รายรับ</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#f43f5e' }} />
                        <span className="text-slate-500">รายจ่าย</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: SAVING_COLOR }} />
                        <span className="text-slate-500">การออม</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#34c986' }} />
                        <span className="text-slate-500">รายรับ</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#fb7185' }} />
                        <span className="text-slate-500">รายจ่าย</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: SAVING_COLOR }} />
                        <span className="text-slate-500">การออม</span>
                      </div>
                    </div>
                  )}
                  <span className="text-xs text-slate-400">
                    {chartTab === 'compare'
                      ? `รายรับ ฿${fmt(barIncomeTotal)} · รายจ่าย ฿${fmt(barExpenseTotal)} · การออม ฿${fmt(barSavingTotal)}`
                      : 'ม.ค. - ธ.ค.'}
                  </span>
                </div>
              </div>

              {chartTab === 'compare' ? (
                <BarChart data={barData} isDarkMode={isDarkMode} />
              ) : (
                <TrendLineChart data={yearTrendData} isDarkMode={isDarkMode} />
              )}

            </div>
          </div>

        </>
      )}

      {/* ── Budgets & Goals ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Budget card */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#EAF3F7] flex items-center justify-center">
                <Wallet size={16} className="text-[#2C6488]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-700">งบประมาณที่กำลังใช้</h3>
            </div>
            <button
              onClick={onGoBudgets}
              className="text-xs font-semibold text-[#2C6488] hover:underline flex items-center gap-0.5"
            >
              ดูทั้งหมด <ChevronRight size={13} />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-2/3" />
                  <div className="h-2 bg-slate-100 rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          ) : topBudgets.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs text-slate-400 mb-3">ยังไม่มีงบประมาณที่ใช้งานอยู่</p>
              <button
                onClick={onGoBudgets}
                className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#EAF3F7] text-[#2C6488] border border-[#DCE8EE] hover:bg-[#DCE8EE] transition-colors"
              >
                ตั้งงบประมาณ
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3.5">
                {topBudgets.map((b) => {
                  const cat = getCatInfo(b.category_id);
                  const over = b.spent > b.limit;
                  const color = over ? '#ef4444' : b.pct >= 80 ? '#f59e0b' : '#10b981';
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color }} />
                          <span className="text-xs font-medium text-slate-600 truncate">{cat.name}</span>
                        </div>
                        <span className="text-xs font-semibold flex-shrink-0" style={{ color }}>
                          ฿{fmt(b.spent)} / {fmt(b.limit)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, b.pct)}%`, background: color }}
                        />
                      </div>
                      {over && (
                        <p className="mt-1 text-[10px] font-medium text-red-500">เกินงบ ฿{fmt(b.spent - b.limit)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400">ใช้ไปรวม</span>
                <span className="font-semibold text-slate-600">
                  ฿{fmt(budgetTotalSpent)} / {fmt(budgetTotalLimit)}
                  <span className="text-slate-400 font-normal"> ({budgetTotalPct}%)</span>
                </span>
              </div>
            </>
          )}
        </div>

        {/* Savings goals card */}
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#EAF3F7] flex items-center justify-center">
                <Target size={16} className="text-[#2C6488]" />
              </div>
              <h3 className="text-sm font-semibold text-slate-700">เป้าหมายการออม</h3>
            </div>
            <button
              onClick={onGoGoals}
              className="text-xs font-semibold text-[#2C6488] hover:underline flex items-center gap-0.5"
            >
              ดูทั้งหมด <ChevronRight size={13} />
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 bg-slate-100 rounded-lg animate-pulse w-2/3" />
                  <div className="h-2 bg-slate-100 rounded-full animate-pulse" />
                </div>
              ))}
            </div>
          ) : topGoals.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs text-slate-400 mb-3">ยังไม่มีเป้าหมายการออมที่กำลังทำอยู่</p>
              <button
                onClick={onGoGoals}
                className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#EAF3F7] text-[#2C6488] border border-[#DCE8EE] hover:bg-[#DCE8EE] transition-colors"
              >
                สร้างเป้าหมาย
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {topGoals.map((g) => (
                <div key={g.id}>
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <span className="text-xs font-medium text-slate-600 truncate">{g.name}</span>
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: SAVING_COLOR }}>{Math.round(g.pct)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${g.pct}%`, background: SAVING_COLOR }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span>฿{fmt(g.current)} / {fmt(g.target)}</span>
                    <span>เหลืออีก ฿{fmt(g.remaining)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

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
