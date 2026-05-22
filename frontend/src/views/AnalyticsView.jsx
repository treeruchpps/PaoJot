import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../components/common/Icon';
import { Sun, Calendar, BarChart2, TrendingUp, TrendingDown, Wallet, ReceiptText, AlertCircle, Sparkles, RefreshCw, X } from 'lucide-react';
import { transactions as txApi, profile as profileApi, aiSummary as aiSummaryApi } from '../services/api';
import { fmt } from '../constants/data';

// ─── Constants ───────────────────────────────────────────────────────────────
const MONTH_LABELS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const THAI_MONTHS  = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม',
];
const PALETTE = ['#2C6488','#10b981','#f59e0b','#2C6488','#ef4444','#ec4899','#5F9A7A','#f97316'];

const PERIOD_CONFIG = [
  { id: 'today', label: 'วันนี้',     icon: 'Sun',      color: '#f59e0b', bg: '#fffbeb', ring: '#fde68a' },
  { id: 'week',  label: 'สัปดาห์นี้', icon: 'Calendar', color: '#2C6488', bg: '#EAF3F7', ring: '#BFD8E4' },
  { id: 'month', label: 'เดือนนี้',   icon: 'BarChart2', color: '#10b981', bg: '#f0fdf4', ring: '#a7f3d0' },
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

// Thai-locale date string with Buddhist era (พ.ศ.)
function thaiDay(dateStr) {
  // dateStr = "YYYY-MM-DD"
  const [, mo, d] = dateStr.split('-').map(Number);
  return `${d} ${THAI_MONTHS[mo - 1]}`;
}
function thaiYear(dateStr) {
  const y = parseInt(dateStr.split('-')[0]);
  return String(y + 543);
}

function periodDateLabel(period, weekStartDay) {
  const { from, to } = getDateRange(period, weekStartDay);
  if (period === 'today') {
    return `${thaiDay(from)} ${thaiYear(from)}`;
  }
  if (period === 'year') {
    return thaiYear(from);
  }
  // week / month: show range, append year only on "to" side
  const fromY = thaiYear(from);
  const toY   = thaiYear(to);
  const sameY = fromY === toY;
  return sameY
    ? `${thaiDay(from)} – ${thaiDay(to)} ${toY}`
    : `${thaiDay(from)} ${fromY} – ${thaiDay(to)} ${toY}`;
}

// ─── Chart: Doughnut ─────────────────────────────────────────────────────────
function DonutChart({ data }) {
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
          backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 2,
          borderColor: '#ffffff',
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
  }, [data]);

  return <canvas ref={canvasRef} width={160} height={160} />;
}

// ─── Chart: Bar ───────────────────────────────────────────────────────────────
function BarChart({ data }) {
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
            grid:  { color: '#f1f5f9' },
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
  }, [data]);

  return <div className="h-48"><canvas ref={canvasRef} /></div>;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AnalyticsView({ accounts, categories }) {
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
  const topAccounts = [...accounts]
    .filter((a) => a.type === 'asset')
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);
  const recentTx = [...txList]
    .sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')))
    .slice(0, 5);
  const aiSummary = aiState?.summary;
  const hasAiSummary = !!aiSummary;
  const showAiSummaryCard = hasAiSummary && showAiSummary;
  const overviewSpan = showAiSummaryCard ? 'lg:col-span-7' : 'lg:col-span-12';

  const getCatName = (id) => {
    if (!id) return 'อื่นๆ';
    return (categories || []).find((c) => c.id === id)?.name || 'อื่นๆ';
  };

  const expByCat = {};
  txList.filter((t) => t.type === 'expense').forEach((t) => {
    const key = t.category_id || '__other__';
    expByCat[key] = (expByCat[key] || 0) + t.amount;
  });
  const donutData = Object.entries(expByCat)
    .map(([id, value]) => ({ label: getCatName(id === '__other__' ? null : id), value }))
    .sort((a, b) => b.value - a.value);

  const top5 = Object.entries(expByCat)
    .map(([id, value]) => {
      const cat = (categories || []).find((c) => c.id === id);
      return {
        id,
        value,
        catName: cat?.name || 'อื่นๆ',
        catIcon: cat?.icon || 'Tag',
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const prevExp   = barData.length >= 2 ? (barData[barData.length - 2]?.expense || 0) : 0;
  const momChange = (period === 'month' && prevExp > 0)
    ? ((expense - prevExp) / prevExp * 100).toFixed(1)
    : null;

  return (
    <div className="p-6 space-y-5">

      {/* ── Overview ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4 items-stretch">
        <div className={`col-span-12 ${overviewSpan} rounded-2xl border border-[#DCE8EE] bg-[#EAF3F7] p-5 overflow-hidden h-full min-h-[280px] flex flex-col justify-between`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[#2C6488] mb-2">ภาพรวมการเงิน</p>
              <h2 className="text-sm text-slate-500 mb-1">ยอดเงินรวม</h2>
              <p className="text-4xl font-bold" style={{ color: '#2C6488' }}>
                ฿{fmt(totalAssets)}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-white/80 flex items-center justify-center border border-white">
              <Wallet size={24} color="#2C6488" />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/75 border border-white px-3 py-3">
              <p className="text-xs text-slate-500 mb-1">เงินทั้งหมด</p>
              <p className="text-lg font-bold text-emerald-600">฿{fmt(totalAssets)}</p>
            </div>
            <div className="rounded-xl bg-white/75 border border-white px-3 py-3">
              <p className="text-xs text-slate-500 mb-1">บัญชีทั้งหมด</p>
              <p className="text-lg font-bold text-[#2C6488]">{accounts.filter((a) => a.type === 'asset').length} บัญชี</p>
            </div>
          </div>
          {!showAiSummaryCard && (
            <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl bg-white/70 border border-white px-4 py-3">
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
                <div className="flex rounded-xl bg-white border border-[#DCE8EE] p-1">
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
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white text-[#2C6488] border border-[#DCE8EE] text-xs font-semibold"
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
            <p className="mt-2 text-xs text-red-500">{aiError}</p>
          )}
        </div>

        {showAiSummaryCard && (
          <div className="col-span-12 lg:col-span-5 rounded-2xl bg-white p-5 shadow-sm border border-slate-100 h-full min-h-[280px] max-h-[280px] flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} color="#2C6488" />
                <h3 className="text-sm font-semibold text-slate-700">AI สรุปการเงิน</h3>
              </div>
              <div className="flex items-center gap-2">
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
                  className="w-8 h-8 rounded-xl bg-[#EAF3F7] text-[#2C6488] inline-flex items-center justify-center disabled:opacity-50"
                  title={aiState?.stale ? 'สรุปใหม่' : 'รีเฟรชสรุป'}
                >
                  <RefreshCw size={15} className={aiLoading ? 'animate-spin' : ''} />
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

            <div className="min-h-0 flex-1 overflow-y-auto pr-2">
              <div className="rounded-xl bg-[#EAF3F7] border border-[#DCE8EE] px-3 py-3 mb-3">
                <p className="text-xs font-semibold text-[#2C6488] mb-1">{aiSummary.title || 'สรุปการเงิน'}</p>
                <p className="text-sm text-slate-700 leading-relaxed">{aiSummary.overview}</p>
              </div>

              <div className="space-y-3">
                {aiSummary.highlights?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1.5">ข้อสังเกต</p>
                    <div className="space-y-1.5">
                      {aiSummary.highlights.slice(0, 4).map((item, idx) => (
                        <p key={idx} className="text-xs text-slate-600 leading-relaxed">• {item}</p>
                      ))}
                    </div>
                  </div>
                )}
                {aiSummary.cautions?.length > 0 && (
                  <div className="rounded-xl bg-amber-50 px-3 py-2.5">
                    <p className="text-xs font-semibold text-amber-700 mb-1">ควรระวัง</p>
                    <div className="space-y-1.5">
                      {aiSummary.cautions.slice(0, 3).map((item, idx) => (
                        <p key={idx} className="text-xs text-amber-700 leading-relaxed">• {item}</p>
                      ))}
                    </div>
                  </div>
                )}
                {aiSummary.suggestions?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-1.5">คำแนะนำ</p>
                    <div className="space-y-1.5">
                      {aiSummary.suggestions.slice(0, 5).map((item, idx) => (
                        <p key={idx} className="text-xs text-slate-600 leading-relaxed">{idx + 1}. {item}</p>
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
      <div className="grid grid-cols-4 gap-4">
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
                background:   active ? pc.bg  : '#ffffff',
                borderColor:  active ? pc.ring : '#f1f5f9',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                    style={{ background: pc.bg }}>
                    {pc.icon === 'Sun' && <Sun size={14} color={pc.color} />}
                    {pc.icon === 'Calendar' && <Calendar size={14} color={pc.color} />}
                    {pc.icon === 'BarChart2' && <BarChart2 size={14} color={pc.color} />}
                    {pc.icon === 'TrendingUp' && <TrendingUp size={14} color={pc.color} />}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: pc.color }}>{pc.label}</span>
                </div>
                {active && (
                  <div className="w-2 h-2 rounded-full" style={{ background: pc.color }} />
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
          <div className="grid grid-cols-5 gap-4">
            {/* Donut */}
            <div className="col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">รายจ่ายตามหมวด</h3>
              <p className="text-xs text-slate-400 mb-3">
                {PERIOD_CONFIG.find((p) => p.id === period)?.label}
                {' · '}฿{fmt(expense)}
              </p>
              {donutData.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">ไม่มีรายจ่าย</div>
              ) : (
                <div className="flex items-start gap-4">
                  <DonutChart data={donutData} />
                  <div className="flex-1 space-y-2 mt-1">
                    {donutData.slice(0, 6).map((d, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: PALETTE[i % PALETTE.length] }} />
                          <span className="text-xs text-slate-600 truncate">{d.label}</span>
                        </div>
                        <span className="text-xs font-medium text-slate-700 flex-shrink-0">฿{fmt(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Bar */}
            <div className="col-span-3 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-slate-700">รายรับ vs รายจ่าย</h3>
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
              </div>
              <p className="text-xs text-slate-400 mb-3">6 เดือนย้อนหลัง</p>
              <BarChart data={barData} />
              {momChange !== null && (
                <div className="mt-3 flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    parseFloat(momChange) < 0 ? 'bg-emerald-50' : 'bg-red-50'
                  }`}>
                    {parseFloat(momChange) < 0
                      ? <TrendingDown size={14} color="#10b981" />
                      : <TrendingUp size={14} color="#ef4444" />}
                  </div>
                  <p className="text-xs text-slate-600">
                    รายจ่ายเดือนนี้{' '}
                    <span className={`font-bold ${parseFloat(momChange) < 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {parseFloat(momChange) < 0 ? 'ลดลง' : 'เพิ่มขึ้น'} {Math.abs(parseFloat(momChange))}%
                    </span>{' '}
                    จากเดือนก่อน
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
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
                          style={{ background: tx.type === 'income' ? '#f0fdf4' : tx.type === 'expense' ? '#fff1f2' : '#EAF3F7' }}>
                          <Icon name={cat?.icon || 'Tag'} size={16} color={tx.type === 'income' ? '#10b981' : tx.type === 'expense' ? '#ef4444' : '#2C6488'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{tx.name || tx.note || 'ไม่มีชื่อรายการ'}</p>
                          <p className="text-xs text-slate-400">{tx.transaction_date?.slice(0, 10) || ''}</p>
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
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700">บัญชีหลัก</h3>
                <Wallet size={16} color="#94a3b8" />
              </div>
              {topAccounts.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">ยังไม่มีบัญชี</div>
              ) : (
                <div className="space-y-3">
                  {topAccounts.map((a) => (
                    <div key={a.id} className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                        <Wallet size={16} color="#2C6488" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{a.name}</p>
                        <p className="text-xs text-slate-400">{a.kind || 'บัญชี'}</p>
                      </div>
                      <p className="text-sm font-bold text-[#2C6488]">฿{fmt(a.balance)}</p>
                    </div>
                  ))}
                </div>
              )}
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
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#EAF3F7]">
                        <Icon name={item.catIcon} size={16} color="#2C6488" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-medium text-slate-700">{item.catName}</p>
                          <p className="text-xs font-bold text-slate-800 ml-2">฿{fmt(item.value)}</p>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#2C6488' }} />
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
    </div>
  );
}
