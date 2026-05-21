import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../components/common/Icon';
import { Sun, Calendar, BarChart2, TrendingUp, TrendingDown } from 'lucide-react';
import { transactions as txApi, profile as profileApi } from '../services/api';
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

  // When period tab changes, just swap txList from cached stats
  const handlePeriodSelect = (id) => {
    setPeriod(id);
    setTxList(periodStats[id]?.data || []);
  };

  // ── Computed ──────────────────────────────────────────────────────────────
  const totalAssets = accounts.filter((a) => a.type === 'asset').reduce((s, a)     => s + a.balance, 0);
  const totalLiab   = accounts.filter((a) => a.type === 'liability').reduce((s, a) => s + a.balance, 0);
  const netWorth    = totalAssets - totalLiab;

  const expense = txList.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

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

      {/* ── Net Worth ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: 'มูลค่าสุทธิ',
            value: netWorth,
            color: netWorth >= 0 ? '#2C6488' : '#ef4444',
            bg:    netWorth >= 0 ? '#EAF3F7' : '#fff1f2',
          },
          { label: 'สินทรัพย์รวม', value: totalAssets, color: '#10b981', bg: '#f0fdf4' },
          { label: 'หนี้สินรวม',   value: totalLiab,   color: '#ef4444', bg: '#fff1f2' },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl p-4 border" style={{ background: s.bg, borderColor: s.color + '40' }}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>
              {s.value < 0 ? '-' : ''}฿{fmt(s.value)}
            </p>
          </div>
        ))}
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
                  <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400">คงเหลือ</span>
                    <span className={`text-xs font-bold ${stats.inc - stats.exp >= 0 ? 'text-[#2C6488]' : 'text-red-500'}`}>
                      {stats.inc - stats.exp < 0 ? '-' : ''}฿{fmt(stats.inc - stats.exp)}
                    </span>
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
