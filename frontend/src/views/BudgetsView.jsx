import { useEffect, useMemo, useState } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Plus, Edit, Trash2, AlertCircle, Wallet, ChartPie, CheckCircle2, Repeat2 } from 'lucide-react';
import Icon from '../components/common/Icon';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { budgets as budgetsApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDateRange } from '../utils/dateFormat';
import { applySavedCategoryOrder } from '../utils/categoryOrder';

const getColor = (pct) => pct <= 50 ? '#10b981' : pct <= 80 ? '#f59e0b' : '#ef4444';

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const getPresetRange = (preset) => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  if (preset === 'week') {
    const day = now.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    const start = new Date(now);
    start.setDate(d + diffToMon);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) };
  }
  if (preset === 'month') {
    return {
      start_date: new Date(y, m, 1).toISOString().slice(0, 10),
      end_date: new Date(y, m + 1, 0).toISOString().slice(0, 10),
    };
  }
  if (preset === 'year') {
    return {
      start_date: new Date(y, 0, 1).toISOString().slice(0, 10),
      end_date: new Date(y, 11, 31).toISOString().slice(0, 10),
    };
  }
  return { start_date: todayStr(), end_date: addDays(todayStr(), 29) };
};
const daysBetween = (from, to) => {
  const a = new Date(from);
  const b = new Date(to);
  return Math.floor((b - a) / 86400000) + 1;
};
const EMPTY_FORM = {
  category_id: '',
  amount: '',
  range_preset: 'month',
  budget_type: 'month',
  ...getPresetRange('month'),
  is_recurring: false,
};
const BUDGET_TABS = [
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'week', label: 'รายสัปดาห์' },
  { value: 'month', label: 'รายเดือน' },
  { value: 'year', label: 'รายปี' },
];
const BUDGET_PAGE_SIZE = 6;
const BUDGET_TYPE_LABEL = {
  week: 'รายสัปดาห์',
  month: 'รายเดือน',
  year: 'รายปี',
  custom: 'กำหนดเอง',
};

export default function BudgetsView({ categories }) {
  const { showError } = useSnackbar();
  const [budgetList, setBudgetList] = useState([]);
  const [budgetPage, setBudgetPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  const expenseCategories = useMemo(
    () => applySavedCategoryOrder('expense', (categories || []).filter((c) => c.type === 'expense')),
    [categories],
  );

  const fetchAll = async () => {
    setLoading(true);
    try {
      const list = (await budgetsApi.list()) || [];
      setBudgetList(list);
    } catch {
      setBudgetList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const getCat = (id) => expenseCategories.find((c) => c.id === id);
  const getCatName = (id) => getCat(id)?.name || 'ไม่พบหมวดหมู่';
  const getStatus = (spent, limit) => {
    if (spent > limit) return { label: 'เกินงบ', color: '#dc2626', bg: '#fef2f2', icon: AlertCircle };
    if (spent === limit && limit > 0) return { label: 'ใช้ครบงบแล้ว', color: '#f59e0b', bg: '#fffbeb', icon: AlertCircle };
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    if (pct >= 80) return { label: 'ใกล้เต็ม', color: '#f59e0b', bg: '#fffbeb', icon: AlertCircle };
    return { label: 'ปกติ', color: '#10b981', bg: '#f0fdf4', icon: CheckCircle2 };
  };

  const openCreate = () => {
    setEditId(null);
    const defaultType = activeTab === 'all' ? 'month' : activeTab;
    setForm({
      ...EMPTY_FORM,
      category_id: expenseCategories[0]?.id || '',
      range_preset: defaultType,
      budget_type: defaultType,
      ...getPresetRange(defaultType),
    });
    setShowModal(true);
  };

  const openEdit = (budget) => {
    setEditId(budget.id);
    setForm({
      category_id: budget.category_id || expenseCategories[0]?.id || '',
      amount: String(budget.amount),
      range_preset: budget.budget_type || 'custom',
      budget_type: budget.budget_type || 'custom',
      start_date: budget.start_date || todayStr(),
      end_date: budget.end_date || addDays(todayStr(), 29),
      is_recurring: !!budget.is_recurring,
    });
    setShowModal(true);
  };

  const save = async () => {
    const amount = parseFloat(form.amount);
    if (!form.category_id) { showError('กรุณาเลือกหมวดหมู่'); return; }
    if (!amount || amount <= 0) { showError('วงเงินต้องมากกว่า 0'); return; }
    if (!form.start_date || !form.end_date) { showError('กรุณาเลือกวันเริ่มต้นและวันสิ้นสุด'); return; }
    if (new Date(form.end_date) < new Date(form.start_date)) { showError('วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น'); return; }
    const duplicate = budgetList.find((b) =>
      b.id !== editId &&
      b.category_id === form.category_id &&
      (b.budget_type || 'custom') === form.budget_type
    );
    if (duplicate) { showError(`หมวดหมู่นี้มีงบประมาณ${BUDGET_TYPE_LABEL[form.budget_type] || ''}อยู่แล้ว`); return; }

    setSaving(true); try {
      const body = {
        category_id: form.category_id,
        amount,
        budget_type: form.budget_type,
        start_date: form.start_date,
        end_date: form.end_date,
        is_recurring: form.is_recurring,
      };
      if (editId) await budgetsApi.update(editId, body);
      else await budgetsApi.create(body);
      await fetchAll();
      setShowModal(false);
    } catch (err) { showError(err.message); }
    finally { setSaving(false); }
  };

  const setRangePreset = (preset) => {
    if (preset === 'custom') {
      setForm({ ...form, range_preset: preset, budget_type: 'custom' });
      return;
    }
    setForm({ ...form, range_preset: preset, budget_type: preset, ...getPresetRange(preset) });
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await budgetsApi.delete(deleteTarget.id);
      await fetchAll();
      setDeleteTarget(null);
    } catch (err) { showError(err.message); }
    finally { setDeleting(false); }
  };

  const visibleBudgets = activeTab === 'all'
    ? budgetList
    : budgetList.filter((b) => (b.budget_type || 'custom') === activeTab);
  const totalLimit = visibleBudgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = visibleBudgets.reduce((s, b) => s + (b.spent || 0), 0);
  const budgetTotalPages = Math.max(1, Math.ceil(visibleBudgets.length / BUDGET_PAGE_SIZE));
  const budgetSafePage   = Math.min(budgetPage, budgetTotalPages);
  const budgetPageNums   = Array.from({ length: budgetTotalPages }, (_, i) => i + 1)
    .filter((p) => budgetTotalPages <= 7 || p === 1 || p === budgetTotalPages || Math.abs(p - budgetSafePage) <= 1);
  const pagedBudgets     = visibleBudgets.slice((budgetSafePage - 1) * BUDGET_PAGE_SIZE, budgetSafePage * BUDGET_PAGE_SIZE);
  const totalPct = totalLimit > 0 ? Math.min(100, Math.round((totalSpent / totalLimit) * 100)) : 0;
  const totalRemaining = Math.max(0, totalLimit - totalSpent);

  return (
    <div className="p-6 space-y-5">
      {!loading && visibleBudgets.length > 0 && (
        <div className="rounded-2xl border border-[#2C6488]/10 bg-[#EAF3F7] p-4 space-y-4">
          <h2 className="text-base font-semibold text-slate-700">ภาพรวมงบประมาณ</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'งบรวม', value: totalLimit, color: '#2C6488', bg: '#EAF3F7' },
              { label: 'ใช้ไปแล้ว', value: totalSpent, color: '#2C6488', bg: '#EAF3F7' },
              { label: 'คงเหลือ', value: totalRemaining, color: '#2C6488', bg: '#EAF3F7' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl p-4 bg-slate-50 border border-slate-100">
                <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                <p className="text-2xl font-bold" style={{ color: s.color }}>
                  {s.suffix ? `${s.value} ${s.suffix}` : `฿${fmt(s.value)}`}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-slate-50 rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-3">
              <p className="text-sm font-semibold text-slate-700">ภาพรวมการใช้งบ</p>
              <p className="text-sm font-bold" style={{ color: getColor(totalPct) }}>{totalPct}%</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${totalPct}%`, background: getColor(totalPct) }} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">งบประมาณ</h2>
          <p className="text-xs text-slate-400 mt-0.5">กำหนดวงเงินตามช่วงวันที่ที่ต้องการ</p>
        </div>
        <button onClick={openCreate}
          className="text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F]">
          <Plus size={13} color="#ffffff" /> เพิ่มงบประมาณ
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {BUDGET_TABS.map((tab) => {
          const active = activeTab === tab.value;
          const count = tab.value === 'all'
            ? budgetList.length
            : budgetList.filter((b) => (b.budget_type || 'custom') === tab.value).length;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => { setActiveTab(tab.value); setBudgetPage(1); }}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                active ? 'bg-[#2C6488] text-white border-[#2C6488]' : 'bg-white text-slate-500 border-slate-200 hover:border-[#BFD8E4]'
              }`}
            >
              {tab.label} <span className={active ? 'text-[#EAF3F7]' : 'text-slate-400'}>{count}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลด...</div>
      ) : visibleBudgets.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          <ChartPie size={40} color="#cbd5e1" />
          <div>
            <p className="text-sm font-semibold text-slate-600">
              {budgetList.length === 0 ? 'ยังไม่มีงบประมาณ' : `ยังไม่มีงบประมาณ${BUDGET_TYPE_LABEL[activeTab] || ''}`}
            </p>
            <p className="text-xs text-slate-400 mt-1">สร้างงบโดยเลือกหมวดหมู่ วงเงิน และช่วงวันที่ที่ต้องการคุมค่าใช้จ่าย</p>
          </div>
          <button onClick={openCreate}
            className="text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F]">
            <Plus size={13} color="#ffffff" /> สร้างงบประมาณแรก
          </button>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pagedBudgets.map((budget) => {
            const spent = budget.spent || 0;
            const pct = budget.amount > 0 ? Math.min(100, Math.round((spent / budget.amount) * 100)) : 0;
            const color = getColor(pct);
            const remain = Math.max(0, budget.amount - spent);
            const status = getStatus(spent, budget.amount);
            const StatusIcon = status.icon;
            const cat = getCat(budget.category_id);
            const totalDays = Math.max(1, daysBetween(budget.start_date, budget.end_date));
            const leftDays = Math.max(0, daysBetween(todayStr(), budget.end_date));
            return (
              <div key={budget.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 card-hover">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: (cat?.color || '#2C6488') + '18' }}>
                      {cat
                        ? <Icon name={cat.icon || 'Tag'} size={18} color={cat.color || '#2C6488'} />
                        : <Wallet size={18} color="#64748b" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-700 truncate">{getCatName(budget.category_id)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {BUDGET_TYPE_LABEL[budget.budget_type || 'custom']} · {formatDisplayDateRange(budget.start_date, budget.end_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {budget.is_recurring && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-[#EAF3F7] text-[#2C6488]">
                        <Repeat2 size={11} color="#2C6488" /> ทำซ้ำ
                      </span>
                    )}
                    <button onClick={() => openEdit(budget)}
                      className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-[#DCE8EE] flex items-center justify-center transition-colors">
                      <Edit size={11} color="#94a3b8" />
                    </button>
                    <button onClick={() => setDeleteTarget(budget)}
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
                    <p className="text-sm font-bold text-slate-700">฿{fmt(budget.amount)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400">คงเหลือ</p>
                    <p className="text-sm font-bold text-emerald-600">฿{fmt(remain)}</p>
                  </div>
                </div>

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
                  <span className="text-slate-400">เหลือ {leftDays} วัน จาก {totalDays} วัน</span>
                </div>

                {spent > budget.amount && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500 bg-red-50 px-2.5 py-1.5 rounded-lg">
                    <AlertCircle size={12} color="#ef4444" />
                    เกินงบประมาณ ฿{fmt(spent - budget.amount)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {visibleBudgets.length > BUDGET_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 px-1 py-3 mt-2 border-t border-slate-100 col-span-full">
              <p className="text-xs text-slate-500">
                แสดง {(budgetSafePage - 1) * BUDGET_PAGE_SIZE + 1}–{Math.min(budgetSafePage * BUDGET_PAGE_SIZE, visibleBudgets.length)} จาก {visibleBudgets.length} รายการ
              </p>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setBudgetPage((p) => Math.max(1, p - 1))} disabled={budgetSafePage === 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                  ก่อนหน้า
                </button>
                {budgetPageNums.map((p, i) => (
                  <button key={`${p}-${i}`} type="button" onClick={() => setBudgetPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-semibold border transition-colors ${budgetSafePage === p ? 'bg-[#2C6488] border-[#2C6488] text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-[#EAF3F7]'}`}>
                    {p}
                  </button>
                ))}
                <button type="button" onClick={() => setBudgetPage((p) => Math.min(budgetTotalPages, p + 1))} disabled={budgetSafePage === budgetTotalPages}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showModal && (
        <Modal title={editId ? 'แก้ไขงบประมาณ' : 'เพิ่มงบประมาณ'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {expenseCategories.map((cat) => (
                  <button key={cat.id} type="button" onClick={() => setForm({ ...form, category_id: cat.id })}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors"
                    style={{ borderColor: form.category_id === cat.id ? (cat.color || '#2C6488') : '#e2e8f0', background: form.category_id === cat.id ? (cat.color || '#2C6488') + '12' : '#f8fafc' }}>
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: (cat.color || '#2C6488') + '22' }}>
                      <Icon name={cat.icon || 'Tag'} size={15} color={cat.color || '#2C6488'} />
                    </span>
                    <span className="font-medium text-slate-700 truncate">{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">วงเงิน (฿)</label>
              <input type="number" min="0" value={form.amount} placeholder="0"
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-500 mb-2 block">ช่วงงบประมาณ</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 'week', label: 'สัปดาห์นี้' },
                    { value: 'month', label: 'เดือนนี้' },
                    { value: 'year', label: 'ปีนี้' },
                    { value: 'custom', label: 'กำหนดเอง' },
                  ].map((item) => {
                    const active = form.range_preset === item.value;
                    return (
                      <button key={item.value} type="button" onClick={() => setRangePreset(item.value)}
                        className={`px-2 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                          active ? 'bg-[#2C6488] text-white border-[#2C6488]' : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-[#BFD8E4]'
                        }`}>
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">วันเริ่มต้น</label>
                <input type="date" value={form.start_date}
                  onChange={(e) => setForm({ ...form, range_preset: 'custom', start_date: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">วันสิ้นสุด</label>
                <input type="date" value={form.end_date}
                  onChange={(e) => setForm({ ...form, range_preset: 'custom', end_date: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-2">
                <Repeat2 size={16} color="#2C6488" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">ทำซ้ำงบประมาณนี้</p>
                  <p className="text-xs text-slate-400 mt-0.5">เมื่อหมดช่วงเวลา ระบบจะเลื่อนไปช่วงถัดไปด้วยจำนวนวันเท่าเดิม</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={form.is_recurring}
                onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
                className="w-4 h-4 accent-[#2C6488]"
              />
            </label>

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
        message={`ต้องการลบงบประมาณ "${getCatName(deleteTarget?.category_id)}" ใช่ไหม?`}
        confirmText="ลบงบประมาณ"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
