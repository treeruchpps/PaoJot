import { useState, useEffect, useRef } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import Icon from '../components/common/Icon';
import {
  Plus, Edit, Trash2, Calendar, CheckCircle, PiggyBank,
  ImageIcon, Trophy, AlertCircle, Upload, X, ArrowDownToLine
} from 'lucide-react';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { AccountSelect } from '../components/common/FinanceSelects';
import { savingsGoals as goalsApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDate } from '../utils/dateFormat';
import { getTransactionAccounts } from '../utils/accountFilters';

const STATUS_LABEL = { in_progress: 'กำลังออม', completed: 'สำเร็จแล้ว', cancelled: 'ยกเลิก' };
const STATUS_COLOR = { in_progress: '#2C6488', completed: '#10b981', cancelled: '#94a3b8' };
const STATUS_BG = { in_progress: '#EAF3F7', completed: '#ecfdf5', cancelled: '#f1f5f9' };
const STATUS_FILTERS = ['in_progress', 'completed'];

const today = new Date().toISOString().slice(0, 10);

function getPlanMonths(startDate, endDate) {
  if (!endDate) return 1;
  const start = startDate ? new Date(startDate) : new Date();
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1;
  const diff = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(diff + 1, 1);
}

const EMPTY_FORM = {
  name: '',
  image_url: '',
  target_amount: '',
  current_amount: '0',
  start_date: today,
  deadline: '',
  account_id: '',
};

function goalMath(goal) {
  const target = Number(goal.target_amount) || 0;
  const current = Number(goal.current_amount) || 0;
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const monthlyNeeded = Math.ceil(remaining / getPlanMonths(goal.start_date, goal.deadline));
  return { target, current, remaining, pct, monthlyNeeded };
}


export default function GoalsView({ accounts, onRefreshAccounts, quickEntryRefreshKey = 0 }) {
  const { showError } = useSnackbar();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('in_progress');

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef(null);

  const [depositGoal, setDepositGoal] = useState(null);
  const [depositForm, setDepositForm] = useState({ from_account_id: '', amount: '', note: '', date: today });
  const [depositSaving, setDepositSaving] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [withdrawGoal, setWithdrawGoal] = useState(null);
  const [withdrawForm, setWithdrawForm] = useState({ to_account_id: '', amount: '', note: '', date: today });
  const [withdrawSaving, setWithdrawSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundAccountId, setRefundAccountId] = useState('');
  const [refundGoal, setRefundGoal] = useState(null);

  const assetAccounts = getTransactionAccounts(accounts);
  const formTargetAmount = Number(form.target_amount) || 0;
  const plannedMonthly = (() => {
    const current = Number(form.current_amount) || 0;
    const remaining = Math.max(0, formTargetAmount - current);
    return Math.ceil(remaining / getPlanMonths(form.start_date, form.deadline));
  })();

  const fetchGoals = async () => {
    setLoading(true);
    try { setGoals((await goalsApi.list()) || []); }
    catch { setGoals([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchGoals(); }, []);
  useEffect(() => {
    if (quickEntryRefreshKey > 0) fetchGoals();
  }, [quickEntryRefreshKey]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, start_date: today, current_amount: '0', account_id: assetAccounts[0]?.id || '' });
    setImageUploading(false);
    setShowModal(true);
  };

  const openEdit = (g) => {
    setEditId(g.id);
    setForm({
      name: g.name || '',
      image_url: g.image_url || '',
      target_amount: String(g.target_amount || ''),
      current_amount: String(g.current_amount || 0),
      start_date: g.start_date?.slice(0, 10) || today,
      deadline: g.deadline?.slice(0, 10) || '',
      account_id: g.account_id || assetAccounts[0]?.id || '',
    });
    setImageUploading(false);
    setShowModal(true);
  };

  const uploadGoalImage = async (file) => {
    if (!file) return;
    setImageUploading(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const uploaded = await goalsApi.uploadImage(body);
      setForm((prev) => ({ ...prev, image_url: uploaded.image_url || '' }));
    } catch (err) {
      showError(err.message);
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const setGoalTargetAmount = (value) => {
    setForm({ ...form, target_amount: value });
  };

  const save = async () => {
    const goalName = form.name.trim();
    if (!goalName || !form.target_amount) { showError('กรุณากรอกชื่อและยอดเป้าหมาย'); return; }
    const normalizedName = goalName.toLowerCase();
    const duplicateGoal = goals.find((g) => g.id !== editId && (g.name || '').trim().toLowerCase() === normalizedName);
    if (duplicateGoal) { showError('มีเป้าหมายชื่อนี้อยู่แล้ว'); return; }
    const targetAmount = parseFloat(form.target_amount);
    if (targetAmount <= 0) { showError('เป้าหมายต้องมากกว่า 0'); return; }
    if (!form.start_date) { showError('กรุณาเลือกวันที่เริ่มต้น'); return; }
    if (!form.deadline) { showError('กรุณาเลือกวันที่สิ้นสุด'); return; }
    if (form.deadline && new Date(form.deadline) < new Date(form.start_date)) {
      showError('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: goalName,
        image_url: form.image_url || null,
        target_amount: targetAmount,
        start_date: form.start_date || today,
        deadline: form.deadline,
      };
      if (editId) await goalsApi.update(editId, body);
      else await goalsApi.create(body);
      await fetchGoals();
      setShowModal(false);
    } catch (err) { showError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (goal) => {
    if (Number(goal.current_amount) > 0) {
      setRefundGoal(goal);
      setRefundAccountId(assetAccounts[0]?.id || '');
      setShowRefundModal(true);
    } else {
      setConfirmAction({ type: 'delete', goal });
    }
  };

  const confirmRefundDelete = async () => {
    if (!refundGoal) return;
    setConfirmLoading(true);
    try {
      await goalsApi.delete(refundGoal.id, refundAccountId);
      await Promise.all([fetchGoals(), onRefreshAccounts?.()]);
      setShowRefundModal(false);
      setRefundGoal(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setConfirmLoading(false);
    }
  };



  const confirmGoalAction = async () => {
    if (!confirmAction?.goal) return;
    const g = confirmAction.goal;
    setConfirmLoading(true);
    try {
      if (confirmAction.type === 'delete') {
        await goalsApi.delete(g.id);
      } else {
        await goalsApi.update(g.id, {
          status: 'cancelled',
        });
      }
      await Promise.all([fetchGoals(), onRefreshAccounts?.()]);
      setConfirmAction(null);
    } catch (err) {
      alert(err.message);
    } finally { setConfirmLoading(false); }
  };

  const openDeposit = (g) => {
    setDepositGoal(g);
    setDepositForm({
      from_account_id: assetAccounts.find((a) => a.id !== g.account_id)?.id || '',
      amount: '',
      note: '',
      date: today,
    });
    setJustCompleted(false);
  };

  const doDeposit = async () => {
    if (!depositGoal.account_id) { showError('เป้าหมายนี้ไม่มีบัญชีเก็บออมเชื่อมโยงอยู่'); return; }
    if (!depositForm.from_account_id) { showError('กรุณาเลือกบัญชีต้นทาง'); return; }
    if (depositForm.from_account_id === depositGoal.account_id) { showError('บัญชีต้นทางต้องไม่ใช่บัญชีเก็บออมของเป้าหมาย'); return; }
    const amount = parseFloat(depositForm.amount);
    if (!depositForm.amount || amount <= 0) { showError('กรุณาใส่จำนวนเงิน'); return; }
    const sourceAccount = accounts.find((a) => a.id === depositForm.from_account_id);
    if (amount > Number(sourceAccount?.balance || 0)) {
      showError(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(sourceAccount?.balance || 0)}`);
      return;
    }
    setDepositSaving(true); try {
      const updated = await goalsApi.deposit(depositGoal.id, {
        from_account_id: depositForm.from_account_id,
        amount,
        note: depositForm.note || null,
        date: depositForm.date || null,
      });
      if (updated.status === 'completed') setJustCompleted(true);
      await Promise.all([fetchGoals(), onRefreshAccounts?.()]);
      if (updated.status !== 'completed') setDepositGoal(null);
    } catch (err) { showError(err.message); }
    finally { setDepositSaving(false); }
  };

  const openWithdraw = (g) => {
    setWithdrawGoal(g);
    setWithdrawForm({ to_account_id: assetAccounts.find((a) => a.id !== g.account_id)?.id || '', amount: '', note: '', date: today });
  };

  const doWithdraw = async () => {
    if (!withdrawGoal.account_id) { showError('เป้าหมายนี้ไม่มีบัญชีเก็บออม'); return; }
    if (!withdrawForm.to_account_id) { showError('กรุณาเลือกบัญชีปลายทาง'); return; }
    const amount = parseFloat(withdrawForm.amount);
    if (!withdrawForm.amount || amount <= 0) { showError('กรุณาใส่จำนวนเงิน'); return; }
    if (amount > withdrawGoal.current_amount) { showError(`ถอนได้สูงสุด ฿${fmt(withdrawGoal.current_amount)}`); return; }
    setWithdrawSaving(true); try {
      const updated = await goalsApi.withdraw(withdrawGoal.id, {
        to_account_id: withdrawForm.to_account_id,
        amount,
        note: withdrawForm.note || null,
        date: withdrawForm.date || null,
      });
      setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      await onRefreshAccounts?.();
      setWithdrawGoal(null);
    } catch (err) {
      showError(err.message || 'เกิดข้อผิดพลาด');
    } finally {
      setWithdrawSaving(false);
    }
  };

  const inProgressGoals = goals.filter((g) => g.status === 'in_progress');
  const totalTarget = inProgressGoals.reduce((s, g) => s + Number(g.target_amount || 0), 0);
  const totalCurrent = inProgressGoals.reduce((s, g) => s + Number(g.current_amount || 0), 0);
  const totalRemaining = Math.max(0, totalTarget - totalCurrent);
  const overviewPct = totalTarget > 0 ? Math.min((totalCurrent / totalTarget) * 100, 100) : 0;
  const completed = goals.filter((g) => g.status === 'completed').length;
  const filteredGoals = goals.filter((g) => g.status === statusFilter);

  const GOAL_PAGE_SIZE = 6;
  const [goalPage, setGoalPage] = useState(1);
  const goalTotalPages = Math.max(1, Math.ceil(filteredGoals.length / GOAL_PAGE_SIZE));
  const goalSafePage   = Math.min(goalPage, goalTotalPages);
  const goalPageNums   = Array.from({ length: goalTotalPages }, (_, i) => i + 1)
    .filter((p) => goalTotalPages <= 7 || p === 1 || p === goalTotalPages || Math.abs(p - goalSafePage) <= 1);
  const pagedGoals     = filteredGoals.slice((goalSafePage - 1) * GOAL_PAGE_SIZE, goalSafePage * GOAL_PAGE_SIZE);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {!loading && goals.length > 0 && (
        <div className="hidden sm:block rounded-2xl border border-[#2C6488]/10 bg-[#EAF3F7] p-4 space-y-3">
          <h2 className="text-base font-semibold text-slate-700">ภาพรวมเป้าหมายการออม</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl p-4 bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">เป้าหมายทั้งหมด</p>
              <p className="text-xl font-bold text-[#2C6488]">{goals.length}</p>
              <p className="text-xs text-slate-500 mt-1">สำเร็จแล้ว {completed} เป้าหมาย</p>
            </div>
            <div className="rounded-2xl p-4 bg-slate-50 border border-slate-100">
              <p className="text-xs text-slate-500 mb-1">ออมแล้วรวม</p>
              <p className="text-xl font-bold text-emerald-600">฿{fmt(totalCurrent)}</p>
              <p className="text-xs text-slate-500 mt-1">จากเป้าหมายที่กำลังออม</p>
            </div>
            <div className="rounded-2xl p-4 bg-slate-50 border border-slate-100 shadow-sm">
              <p className="text-xs text-slate-500 mb-1">ต้องออมเพิ่ม</p>
              <div className="flex items-end justify-between gap-3">
                <p className="text-xl font-bold text-[#2C6488]">฿{fmt(totalRemaining)}</p>
                <p className="text-sm font-bold text-[#2C6488]">{overviewPct.toFixed(0)}%</p>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-[#2C6488]" style={{ width: `${overviewPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">เป้าหมายการออม</h2>
          <p className="text-xs text-slate-400 mt-0.5">ติดตามความคืบหน้าและออมเงินเข้าเป้าหมาย</p>
        </div>
        <button onClick={openCreate}
          className="text-xs px-3 py-2 rounded-xl font-medium flex items-center justify-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F]">
          <Plus size={13} color="#ffffff" /> เพิ่มเป้าหมาย
        </button>
      </div>

      {!loading && goals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => {
            const active = statusFilter === status;
            const count = goals.filter((g) => g.status === status).length;
            return (
              <button key={status} onClick={() => { setStatusFilter(status); setGoalPage(1); }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  active ? 'bg-[#2C6488] text-white border-[#2C6488]' : 'bg-white text-slate-500 border-slate-200 hover:border-[#BFD8E4]'
                }`}>
                {STATUS_LABEL[status]} <span className={active ? 'text-[#EAF3F7]' : 'text-slate-400'}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลด...</div>
      ) : goals.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          <PiggyBank size={40} color="#cbd5e1" />
          <div>
            <p className="text-sm font-semibold text-slate-600">ยังไม่มีเป้าหมายการออม</p>
            <p className="text-xs text-slate-400 mt-1">สร้างเป้าหมายแรกเพื่อเริ่มเห็นความคืบหน้าชัดๆ</p>
          </div>
          <button onClick={openCreate}
            className="text-xs px-3 py-2 rounded-xl font-medium flex items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F]">
            <Plus size={13} color="#ffffff" /> สร้างเป้าหมายแรก
          </button>
        </div>
      ) : filteredGoals.length === 0 ? (
        <div className="py-14 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-100">
          ไม่มีเป้าหมายในสถานะนี้
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
          {pagedGoals.map((g) => {
            const { target, current, pct, monthlyNeeded } = goalMath(g);
            const isDone = g.status === 'completed';
            const isCancelled = g.status === 'cancelled';
            const color = STATUS_COLOR[g.status] || '#2C6488';

            return (
              <div key={g.id}
                className={`bg-white rounded-2xl shadow-sm border card-hover overflow-hidden flex sm:block ${isDone ? 'border-emerald-200' : 'border-slate-100'}`}>
                {g.image_url ? (
                  <div className="w-24 flex-shrink-0 sm:w-auto sm:aspect-[16/10] bg-slate-100 overflow-hidden">
                    <img src={g.image_url} alt={g.name} className="w-full h-full object-cover object-center" />
                  </div>
                ) : (
                  <div className="w-24 flex-shrink-0 sm:w-auto sm:aspect-[16/10] bg-gradient-to-br from-[#EAF3F7] to-[#EAF7E8] flex items-center justify-center">
                    <div className="w-12 h-12 rounded-2xl bg-white/80 flex items-center justify-center shadow-sm">
                      <Icon name="PiggyBank" size={24} color="#2C6488" />
                    </div>
                  </div>
                )}

                <div className="flex-1 min-w-0 p-4 sm:p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{g.name}</p>
                      <span className="inline-flex mt-1 text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ color, background: STATUS_BG[g.status] }}>
                        {STATUS_LABEL[g.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!isDone && !isCancelled && (
                        <button onClick={() => openEdit(g)}
                          title="แก้ไขเป้าหมาย"
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-[#DCE8EE] flex items-center justify-center transition-colors">
                          <Edit size={12} color="#64748b" />
                        </button>
                      )}

                      <button onClick={() => remove(g)}
                        title="ลบเป้าหมาย"
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
                        <Trash2 size={12} color="#64748b" />
                      </button>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-end justify-between gap-3 mb-2">
                      <div>
                        <p className="text-xs text-slate-400">จำนวนเงินออมของเป้าหมาย</p>
                        <p className="text-sm font-bold text-slate-700">฿{fmt(current)} / ฿{fmt(target)}</p>
                      </div>
                      <p className="text-lg font-bold text-[#2C6488]">{pct.toFixed(0)}%</p>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: isDone ? '#10b981' : '#2C6488' }} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500 mb-4">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Calendar size={12} color="#94a3b8" />
                      <span className="truncate">
                        เริ่ม {formatDisplayDate(g.start_date)}{g.deadline ? ` - สิ้นสุด ${formatDisplayDate(g.deadline)}` : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">ต้องออมต่อเดือน</span>
                      <span className="font-semibold text-slate-700">฿{fmt(monthlyNeeded)}</span>
                    </div>
                  </div>

                  {isDone ? (
                    <div className="flex items-center gap-2 bg-emerald-50 rounded-xl px-3 py-2.5 mt-4">
                      <CheckCircle size={16} color="#10b981" />
                      <p className="text-xs text-emerald-600 font-medium">บรรลุเป้าหมายแล้ว</p>
                    </div>
                  ) : isCancelled ? (
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2.5 mt-4">
                      <X size={16} color="#94a3b8" />
                      <p className="text-xs text-slate-500 font-medium">ยกเลิกเป้าหมายแล้ว</p>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button onClick={() => openDeposit(g)} disabled={assetAccounts.length === 0}
                        className="w-full py-2 rounded-xl text-sm font-semibold text-white bg-[#2C6488] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                        <span className="flex items-center justify-center gap-2">
                          <PiggyBank size={15} color="white" />
                          ออมเงิน
                        </span>
                      </button>
                      <button onClick={() => openWithdraw(g)} disabled={assetAccounts.length === 0 || g.current_amount <= 0}
                        className="w-full py-2 rounded-xl text-sm font-semibold text-[#2C6488] border border-[#2C6488] bg-white transition-colors hover:bg-[#EAF3F7] disabled:opacity-40 disabled:cursor-not-allowed">
                        <span className="flex items-center justify-center gap-2">
                          <ArrowDownToLine size={15} color="#2C6488" />
                          ถอนเงิน
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredGoals.length > GOAL_PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-1 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              แสดง {(goalSafePage - 1) * GOAL_PAGE_SIZE + 1}–{Math.min(goalSafePage * GOAL_PAGE_SIZE, filteredGoals.length)} จาก {filteredGoals.length} เป้าหมาย
            </p>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setGoalPage((p) => Math.max(1, p - 1))} disabled={goalSafePage === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                ก่อนหน้า
              </button>
              {goalPageNums.map((p, i) => (
                <button key={`${p}-${i}`} type="button" onClick={() => setGoalPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold border transition-colors ${goalSafePage === p ? 'bg-[#2C6488] border-[#2C6488] text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-[#EAF3F7]'}`}>
                  {p}
                </button>
              ))}
              <button type="button" onClick={() => setGoalPage((p) => Math.min(goalTotalPages, p + 1))} disabled={goalSafePage === goalTotalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                ถัดไป
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {showModal && (
        <Modal title={editId ? 'แก้ไขเป้าหมาย' : 'เพิ่มเป้าหมายใหม่'} onClose={() => setShowModal(false)} size="lg">
          <div className="space-y-4 max-h-[75vh] overflow-y-auto p-1">
            {assetAccounts.length === 0 && (
              <p className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">
                ต้องมีบัญชีก่อนจึงจะสร้างเป้าหมายการออมได้
              </p>
            )}

            <section className="space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase">รายละเอียดเป้าหมาย</p>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อเป้าหมาย</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="เช่น เที่ยวญี่ปุ่น, ซื้อรถ, เงินฉุกเฉิน"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
            </section>

            <section className="space-y-4 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase">จำนวนเงิน</p>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">จำนวนเงินเป้าหมาย</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">฿</span>
                  <input type="number" min="0" value={form.target_amount}
                    onChange={(e) => setGoalTargetAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-sm bg-slate-50 text-slate-700 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2C6488]/20 focus:border-[#2C6488] transition-all duration-200" />
                </div>
                <p className="text-xs text-slate-400 mt-1">กรอกยอดเงินที่ต้องการออมให้ถึงเป้าหมาย</p>
              </div>

            </section>

            <section className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase">แผนออม</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่เริ่มต้น</label>
                  <input type="date" value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่สิ้นสุด</label>
                  <input type="date" value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                </div>
              </div>
              <div className="rounded-2xl border border-[#DCE8EE] bg-[#EAF3F7] px-3 py-2.5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-[#6F9DB6]">ควรออมประมาณต่อเดือน</p>
                  <p className="text-xs text-slate-500 mt-0.5">คำนวณจากยอดคงเหลือและช่วงวันที่ที่เลือก</p>
                </div>
                <p className="text-lg font-bold text-[#2C6488] whitespace-nowrap">฿{fmt(plannedMonthly)}</p>
              </div>
            </section>

            <section className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase">รูปภาพ</p>
              <div className="aspect-[16/9] rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center">
                {form.image_url ? (
                  <img src={form.image_url} alt="ตัวอย่างรูปเป้าหมาย" className="w-full h-full object-cover object-center" />
                ) : (
                  <div className="text-center text-slate-400">
                    <ImageIcon size={24} color="#94a3b8" className="mx-auto mb-1" />
                    <p className="text-xs">ตัวอย่างรูปเป้าหมาย</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="วางลิงก์รูป หรืออัปโหลดจากเครื่อง"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageUploading}
                  className="px-4 py-2.5 rounded-xl border border-[#2C6488] bg-[#2C6488] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:bg-[#25536F] hover:border-[#25536F] disabled:opacity-60">
                  <Upload size={14} color="#ffffff" />
                  {imageUploading ? 'กำลังอัปโหลด...' : 'อัปโหลดรูป'}
                </button>
              </div>
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => uploadGoalImage(e.target.files?.[0])} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">รองรับ JPG, PNG, WEBP ขนาดไม่เกิน 5MB และแก้ไขรูปได้ภายหลัง</p>
                {form.image_url && (
                  <button type="button" onClick={() => setForm({ ...form, image_url: '' })}
                    className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1">
                    <X size={12} /> ลบรูป
                  </button>
                )}
              </div>
            </section>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium">ยกเลิก</button>
              <button onClick={save} disabled={saving || assetAccounts.length === 0}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {depositGoal && (
        <Modal title="ออมเงิน" onClose={() => setDepositGoal(null)}>
          <div className="space-y-4">
            {justCompleted ? (
              <div className="py-8 flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Trophy size={34} color="#10b981" />
                </div>
                <p className="text-lg font-bold text-slate-800">บรรลุเป้าหมายแล้ว! 🎉</p>
                <p className="text-sm text-slate-500">{depositGoal.name} ครบตามเป้าหมายแล้ว</p>
                <button onClick={() => setDepositGoal(null)}
                  className="mt-2 px-8 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold">
                  ปิด
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const g = goals.find((x) => x.id === depositGoal.id) || depositGoal;
                  const { current, remaining, pct } = goalMath(g);
                  return (
                    <div className="rounded-xl bg-[#EAF3F7] px-4 py-3">
                      <p className="text-sm font-semibold text-[#2C6488] mb-2">{depositGoal.name}</p>
                      <div className="w-full bg-[#BFD8E4]/50 rounded-full h-1.5 overflow-hidden mb-2">
                        <div className="h-full rounded-full bg-[#2C6488]" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between text-xs text-[#25536F]">
                        <span>ออมแล้ว ฿{fmt(current)}</span>
                        <span>เหลือ ฿{fmt(remaining)}</span>
                      </div>
                    </div>
                  );
                })()}

                {!depositGoal.account_id && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">
                    เป้าหมายนี้ยังไม่ผูกบัญชีเก็บออม กรุณาแก้ไขเป้าหมายก่อน
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">จากบัญชี</label>
                  <AccountSelect
                    value={depositForm.from_account_id}
                    onChange={(v) => setDepositForm({ ...depositForm, from_account_id: v })}
                    accounts={assetAccounts.filter((a) => a.id !== depositGoal.account_id)}
                    placeholder="เลือกบัญชีต้นทาง"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">จำนวนเงิน (฿)</label>
                  <input
                    type="number" inputMode="decimal" value={depositForm.amount}
                    placeholder="0.00" min="0"
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-lg font-bold bg-slate-50 text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
                    <input type="date" value={depositForm.date}
                      onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                    <input value={depositForm.note} placeholder="ไม่บังคับ"
                      onChange={(e) => setDepositForm({ ...depositForm, note: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
                  </div>
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setDepositGoal(null)}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium">
                    ยกเลิก
                  </button>
                  <button onClick={doDeposit} disabled={depositSaving || !depositGoal.account_id}
                    className="flex-[2] text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 bg-[#2C6488]">
                    <PiggyBank size={15} />
                    {depositSaving ? 'กำลังบันทึก...' : 'ออมเงิน'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      {withdrawGoal && (
        <Modal title="ถอนเงินออม" onClose={() => setWithdrawGoal(null)}>
          <div className="space-y-4">
            {(() => {
              const g = goals.find((x) => x.id === withdrawGoal.id) || withdrawGoal;
              const { current, pct } = goalMath(g);
              return (
                <div className="rounded-xl bg-[#EAF3F7] px-4 py-3">
                  <p className="text-sm font-semibold text-[#2C6488] mb-2">{withdrawGoal.name}</p>
                  <div className="w-full bg-[#BFD8E4]/50 rounded-full h-1.5 overflow-hidden mb-2">
                    <div className="h-full rounded-full bg-[#2C6488]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-[#25536F]">ยอดออมปัจจุบัน ฿{fmt(current)}</p>
                </div>
              );
            })()}

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">โอนเข้าบัญชี</label>
              <AccountSelect
                value={withdrawForm.to_account_id}
                onChange={(v) => setWithdrawForm({ ...withdrawForm, to_account_id: v })}
                accounts={assetAccounts.filter((a) => a.id !== withdrawGoal.account_id)}
                placeholder="เลือกบัญชีปลายทาง"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">จำนวนที่ถอน (฿)</label>
              <input
                type="number" inputMode="decimal" value={withdrawForm.amount}
                placeholder="0.00" min="0" max={withdrawGoal.current_amount}
                onChange={(e) => setWithdrawForm({ ...withdrawForm, amount: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-lg font-bold bg-slate-50 text-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
                <input type="date" value={withdrawForm.date}
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, date: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                <input value={withdrawForm.note} placeholder="ไม่บังคับ"
                  onChange={(e) => setWithdrawForm({ ...withdrawForm, note: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setWithdrawGoal(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium">
                ยกเลิก
              </button>
              <button onClick={doWithdraw} disabled={withdrawSaving || !withdrawGoal.account_id}
                className="flex-[2] text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 bg-[#2C6488]">
                <ArrowDownToLine size={15} />
                {withdrawSaving ? 'กำลังบันทึก...' : 'ถอนเงิน'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showRefundModal && refundGoal && (
        <Modal title="คืนเงินและลบเป้าหมาย" onClose={() => { setShowRefundModal(false); setRefundGoal(null); }}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-amber-900">มีเงินสะสมคงเหลือในเป้าหมาย</p>
                <p className="text-xs mt-0.5">
                  เป้าหมาย "{refundGoal.name}" มียอดเงินสะสม ฿{fmt(refundGoal.current_amount || 0)} การลบเป้าหมายนี้จะโอนเงินทั้งหมดคืนไปยังบัญชีที่คุณเลือกด้านล่างโดยอัตโนมัติ
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">เลือกบัญชีที่จะรับเงินคืน</label>
              <AccountSelect
                value={refundAccountId}
                onChange={setRefundAccountId}
                accounts={assetAccounts}
                placeholder="เลือกบัญชีรับเงินคืน"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowRefundModal(false); setRefundGoal(null); }}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmRefundDelete}
                disabled={!refundAccountId || confirmLoading}
                className="flex-1 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 bg-red-600 hover:bg-red-700 transition-colors"
              >
                {confirmLoading ? 'กำลังดำเนินการ...' : 'คืนเงินและลบเป้าหมาย'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === 'cancel' ? 'ยกเลิกเป้าหมาย' : 'ลบเป้าหมาย'}
        message={confirmAction?.type === 'cancel'
          ? `ต้องการยกเลิกเป้าหมาย "${confirmAction?.goal?.name || ''}" ใช่ไหม? เป้าหมายจะยังอยู่ในประวัติแต่ออมเงินต่อไม่ได้`
          : `ต้องการลบเป้าหมาย "${confirmAction?.goal?.name || ''}" ใช่ไหม?`}
        confirmText={confirmAction?.type === 'cancel' ? 'ยกเลิกเป้าหมาย' : 'ลบเป้าหมาย'}
        tone={confirmAction?.type === 'cancel' ? 'warning' : 'danger'}
        loading={confirmLoading}
        onClose={() => setConfirmAction(null)}
        onConfirm={confirmGoalAction}
      />
    </div>
  );
}
