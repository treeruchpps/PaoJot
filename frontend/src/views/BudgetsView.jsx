import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, AlertCircle, Wallet, CalendarDays, Calendar, CalendarRange, CheckCircle2 } from 'lucide-react';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { budgets as budgetsApi, transactions as txApi } from '../services/api';
import { fmt } from '../constants/data';

const getColor = (pct) => pct <= 50 ? '#10b981' : pct <= 80 ? '#f59e0b' : '#ef4444';
const getBg    = (pct) => pct <= 50 ? '#f0fdf4' : pct <= 80 ? '#fefce8' : '#fff1f2';
const getStatus = (spent, limit) => {
  if (spent > limit) return { label: 'เกินงบ', color: '#dc2626', bg: '#fef2f2', icon: AlertCircle };
  if (spent === limit && limit > 0) return { label: 'ใช้ครบงบแล้ว', color: '#f59e0b', bg: '#fffbeb', icon: AlertCircle };
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  if (pct >= 80) return { label: 'ใกล้เต็ม', color: '#f59e0b', bg: '#fffbeb', icon: AlertCircle };
  return { label: 'ปกติ', color: '#10b981', bg: '#f0fdf4', icon: CheckCircle2 };
};

const PERIOD_CONFIG = {
  weekly:  { label: 'รายสัปดาห์', icon: CalendarDays,  color: '#5F9A7A', bg: '#EAF7E8' },
  monthly: { label: 'รายเดือน',   icon: Calendar,       color: '#2C6488', bg: '#EAF3F7' },
  yearly:  { label: 'รายปี',      icon: CalendarRange,  color: '#10b981', bg: '#f0fdf4' },
};
const PERIOD_ORDER = ['weekly', 'monthly', 'yearly'];

const pad2 = (n) => String(n).padStart(2, '0');

// ช่วงวันของแต่ละ period
function getPeriodRange(period) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const dow = now.getDay(); // 0=Sun

  if (period === 'monthly') {
    return {
      from: `${y}-${pad2(m)}-01`,
      to:   `${y}-${pad2(m)}-${pad2(new Date(y, m, 0).getDate())}`,
    };
  }
  if (period === 'weekly') {
    // สัปดาห์จันทร์–อาทิตย์
    const diffToMon = (dow === 0 ? -6 : 1 - dow);
    const mon = new Date(now); mon.setDate(d + diffToMon);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return {
      from: mon.toISOString().slice(0, 10),
      to:   sun.toISOString().slice(0, 10),
    };
  }
  if (period === 'yearly') {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return { from: `${y}-${pad2(m)}-01`, to: `${y}-${pad2(m)}-${pad2(new Date(y, m, 0).getDate())}` };
}

const EMPTY_FORM = {
  name: '', category_id: '', amount: '', period: 'monthly',
};

export default function BudgetsView({ categories }) {
  const [budgetList,  setBudgetList]  = useState([]);
  const [spending,    setSpending]    = useState({}); // { [period]: { [category_id | '__none__']: amount } }
  const [allExpenses, setAllExpenses] = useState({}); // { [period]: total }
  const [loading,     setLoading]     = useState(true);
  const [periodFilter, setPeriodFilter] = useState('all');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ── ดึงข้อมูล ──────────────────────────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    try {
      const bl = (await budgetsApi.list()) || [];
      setBudgetList(bl);

      // หา periods ที่ต้องดึง
      const periods = [...new Set(bl.map((b) => b.period))];

      // ดึง transactions ต่อ period แล้วรวม spending
      const spentMap  = {};  // period → category_id → amount
      const allMap    = {};  // period → total expense (สำหรับ budget ที่ไม่มี category)

      await Promise.all(periods.map(async (period) => {
        const { from, to } = getPeriodRange(period);
        const res = await txApi.list({
          type: 'expense', date_from: from, date_to: to, limit: 10000,
        });
        const txs = res?.data || [];

        // รวมต่อ category
        spentMap[period] = {};
        txs.forEach((tx) => {
          const key = tx.category_id || '__none__';
          spentMap[period][key] = (spentMap[period][key] || 0) + tx.amount;
        });

        // รวม all expenses ของ period นี้
        allMap[period] = txs.reduce((s, t) => s + t.amount, 0);
      }));

      setSpending(spentMap);
      setAllExpenses(allMap);
    } catch {
      setBudgetList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // ── helpers ──────────────────────────────────────────────────────────────
  const getCatName = (id) => (categories || []).find((c) => c.id === id)?.name || '—';

  // คำนวณ spent ของแต่ละ budget
  const getSpent = (b) => {
    if (b.category_id) return spending[b.period]?.[b.category_id] || 0;
    return allExpenses[b.period] || 0;
  };

  // ── Modal helpers ─────────────────────────────────────────────────────────
  const openCreate = () => { setEditId(null); setForm(EMPTY_FORM); setError(''); setShowModal(true); };
  const openEdit   = (b)  => {
    setEditId(b.id);
    setForm({
      name:        b.name,
      category_id: b.category_id || '',
      amount:      String(b.amount),
      period:      b.period,
    });
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name || !form.amount) { setError('กรุณากรอกชื่อและวงเงิน'); return; }
    const amount = parseFloat(form.amount);
    if (amount <= 0) { setError('วงเงินต้องมากกว่า 0'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        name:        form.name,
        category_id: form.category_id || null,
        amount,
        period:      form.period,
      };
      if (editId) {
        await budgetsApi.update(editId, body);
      } else {
        await budgetsApi.create(body);
      }
      await fetchAll();
      setShowModal(false);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await budgetsApi.delete(deleteTarget.id);
      await fetchAll();
      setDeleteTarget(null);
    } catch (err) { alert(err.message); }
    finally { setDeleting(false); }
  };

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalLimit = budgetList.reduce((s, b) => s + b.amount, 0);
  const totalSpent = budgetList.reduce((s, b) => s + getSpent(b), 0);
  const totalPct   = totalLimit > 0 ? Math.min(100, Math.round((totalSpent / totalLimit) * 100)) : 0;
  const visibleBudgets = periodFilter === 'all'
    ? budgetList
    : budgetList.filter((b) => b.period === periodFilter);
  const visiblePeriods = periodFilter === 'all' ? PERIOD_ORDER : [periodFilter];
  const overBudgetCount = budgetList.filter((b) => getSpent(b) > b.amount).length;
  const totalRemaining = Math.max(0, totalLimit - totalSpent);

  return (
    <div className="p-6 space-y-5">

      {/* ── Summary ────────────────────────────────────────────────────────── */}
      {!loading && budgetList.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'งบรวม', value: totalLimit, color: '#2C6488', bg: '#EAF3F7' },
              { label: 'ใช้ไปแล้ว', value: totalSpent, color: getColor(totalPct), bg: getBg(totalPct) },
              { label: 'คงเหลือ', value: totalRemaining, color: '#10b981', bg: '#f0fdf4' },
              { label: 'เกินงบ', value: overBudgetCount, suffix: 'รายการ', color: overBudgetCount > 0 ? '#ef4444' : '#64748b', bg: overBudgetCount > 0 ? '#fff1f2' : '#f8fafc' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl p-4 border" style={{ background: s.bg, borderColor: s.color + '33' }}>
                <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                <p className="text-2xl font-bold" style={{ color: s.color }}>
                  {s.suffix ? `${s.value} ${s.suffix}` : `฿${fmt(s.value)}`}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-3">
              <p className="text-sm font-semibold text-slate-700">ภาพรวมการใช้งบ</p>
              <p className="text-sm font-bold" style={{ color: getColor(totalPct) }}>{totalPct}%</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${totalPct}%`, background: getColor(totalPct) }} />
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-slate-700">ภาพรวมตามช่วงเวลา</p>
              <p className="text-xs text-slate-400">งบ / ใช้ / เหลือ</p>
            </div>
            <div className="space-y-3">
              {PERIOD_ORDER.map((period) => {
              const group = budgetList.filter((b) => b.period === period);
              if (group.length === 0) return null;
              const pc           = PERIOD_CONFIG[period];
              const PeriodIcon   = pc.icon;
              const periodLimit  = group.reduce((s, b) => s + b.amount, 0);
              const periodSpent  = group.reduce((s, b) => s + getSpent(b), 0);
              const remaining    = Math.max(0, periodLimit - periodSpent);
              const pct          = periodLimit > 0 ? Math.min(100, Math.round((periodSpent / periodLimit) * 100)) : 0;
              return (
                <div key={period} className="grid grid-cols-12 gap-3 items-center rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                  <div className="col-span-12 md:col-span-3 flex items-center gap-2">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: pc.bg }}>
                      <PeriodIcon size={17} color={pc.color} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{pc.label}</p>
                      <p className="text-xs text-slate-400">{group.length} รายการ</p>
                    </div>
                  </div>
                  <div className="col-span-12 md:col-span-7 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[11px] text-slate-400">งบ</p>
                      <p className="text-sm font-bold text-slate-700">฿{fmt(periodLimit)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">ใช้</p>
                      <p className="text-sm font-bold" style={{ color: getColor(pct) }}>฿{fmt(periodSpent)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">เหลือ</p>
                      <p className="text-sm font-bold text-emerald-600">฿{fmt(remaining)}</p>
                    </div>
                  </div>
                  <div className="col-span-12 md:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold" style={{ color: getColor(pct) }}>{pct}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: getColor(pct) }} />
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">งบแยกตามหมวดหมู่</h2>
          <p className="text-xs text-slate-400 mt-0.5">ติดตามวงเงินตามช่วงเวลาและหมวดค่าใช้จ่าย</p>
        </div>
        <button onClick={openCreate}
          className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium">
          <Plus size={15} color="white" /> เพิ่มงบ
        </button>
      </div>

      <div className="flex bg-slate-100 rounded-xl p-1 gap-1 w-fit">
        {[
          { value: 'all', label: 'ทั้งหมด' },
          ...PERIOD_ORDER.map((p) => ({ value: p, label: PERIOD_CONFIG[p].label })),
        ].map((item) => (
          <button key={item.value} type="button" onClick={() => setPeriodFilter(item.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              periodFilter === item.value ? 'bg-white text-[#2C6488] shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {item.label}
          </button>
        ))}
      </div>

      {/* ── Budget cards ─────────────────────────────────────────────────────  */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลด...</div>
      ) : visibleBudgets.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          <Wallet size={40} color="#cbd5e1" />
          <div>
            <p className="text-sm font-semibold text-slate-600">{budgetList.length === 0 ? 'ยังไม่มีงบประมาณ' : 'ไม่มีงบในช่วงนี้'}</p>
            <p className="text-xs text-slate-400 mt-1">
              {budgetList.length === 0 ? 'สร้างงบแรกเพื่อเริ่มติดตามค่าใช้จ่ายให้ชัดขึ้น' : 'ลองเปลี่ยนช่วงเวลาเพื่อดูงบประมาณอื่น'}
            </p>
          </div>
          {budgetList.length === 0 && (
            <button onClick={openCreate}
              className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium">
              <Plus size={15} color="white" /> สร้างงบประมาณแรก
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {visiblePeriods.map((period) => {
            const group = visibleBudgets.filter((b) => b.period === period);
            if (group.length === 0) return null;
            const pc = PERIOD_CONFIG[period];
            const PeriodIcon = pc.icon;
            return (
              <div key={period}>
                {/* Section header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-xl flex items-center justify-center"
                    style={{ background: pc.bg }}>
                    <PeriodIcon size={15} color={pc.color} />
                  </div>
                  <h3 className="text-sm font-semibold" style={{ color: pc.color }}>{pc.label}</h3>
                  <span className="text-xs text-slate-400">{group.length} รายการ</span>
                </div>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {group.map((b) => {
                    const spent  = getSpent(b);
                    const pct    = b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0;
                    const color  = getColor(pct);
                    const bg     = getBg(pct);
                    const remain = Math.max(0, b.amount - spent);
                    const status = getStatus(spent, b.amount);
                    const StatusIcon = status.icon;
                    return (
                      <div key={b.id} className="bg-white rounded-2xl p-4 shadow-sm border card-hover"
                        style={{ borderColor: pc.color + '22' }}>
                        <div className="flex items-start justify-between mb-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-slate-700 truncate">{b.name}</p>
                            {b.category_id && (
                              <p className="text-xs text-slate-400 mt-0.5">{getCatName(b.category_id)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ color, background: bg }}>{pct}%</span>
                            <button onClick={() => openEdit(b)}
                              className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-[#DCE8EE] flex items-center justify-center transition-colors">
                              <Edit size={11} color="#94a3b8" />
                            </button>
                            <button onClick={() => setDeleteTarget(b)}
                              className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
                              <Trash2 size={11} color="#94a3b8" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 mb-3">
                          <div>
                            <p className="text-[11px] text-slate-400">ใช้ไป</p>
                            <p className="text-sm font-bold" style={{ color }}>฿{fmt(spent)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-slate-400">วงเงิน</p>
                            <p className="text-sm font-bold text-slate-700">฿{fmt(b.amount)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] text-slate-400">คงเหลือ</p>
                            <p className="text-sm font-bold text-emerald-600">฿{fmt(remain)}</p>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: color }} />
                        </div>

                        <div className="flex justify-between items-center text-xs mt-2">
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg font-semibold"
                            style={{ color: status.color, background: status.bg }}>
                            <StatusIcon size={12} color={status.color} />
                            {status.label}
                          </span>
                          <span className="text-slate-400">ใช้ไป {pct}%</span>
                        </div>

                        {spent > b.amount && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500 bg-red-50 px-2.5 py-1.5 rounded-lg">
                            <AlertCircle size={12} color="#ef4444" />
                            เกินงบประมาณ ฿{fmt(spent - b.amount)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ────────────────────────────────────────────────────────────── */}
      {showModal && (
        <Modal title={editId ? 'แก้ไขงบประมาณ' : 'เพิ่มงบประมาณ'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่องบประมาณ</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น อาหาร, เดินทาง"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                <button type="button" onClick={() => setForm({ ...form, category_id: '' })}
                  className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                  style={{ borderColor: form.category_id === '' ? '#2C6488' : '#e2e8f0', background: form.category_id === '' ? '#EAF3F7' : '#f8fafc' }}>
                  <span className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center">
                    <Wallet size={15} color="#64748b" />
                  </span>
                  <span className="font-medium text-slate-700">รวมทุกหมวด</span>
                </button>
                {(categories || []).filter((c) => c.type === 'expense').map((c) => (
                  <button key={c.id} type="button" onClick={() => setForm({ ...form, category_id: c.id })}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                    style={{ borderColor: form.category_id === c.id ? (c.color || '#2C6488') : '#e2e8f0', background: form.category_id === c.id ? (c.color || '#2C6488') + '12' : '#f8fafc' }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: (c.color || '#2C6488') + '22' }}>
                      <Icon name={c.icon || 'Tag'} size={15} color={c.color || '#2C6488'} />
                    </span>
                    <span className="font-medium text-slate-700 truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">วงเงิน (฿)</label>
                <input type="number" min="0" value={form.amount} placeholder="0"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">ช่วงเวลางบประมาณ</label>
                <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700">
                  <option value="monthly">รายเดือน</option>
                  <option value="weekly">รายสัปดาห์</option>
                  <option value="yearly">รายปี</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium">
                ยกเลิก
              </button>
              <button onClick={save} disabled={saving}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="ลบงบประมาณ"
        message={`ต้องการลบงบประมาณ "${deleteTarget?.name || ''}" ใช่ไหม?`}
        confirmText="ลบงบประมาณ"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
