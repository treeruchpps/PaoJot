import { useState, useEffect, useRef } from 'react';
import Icon from '../components/common/Icon';
import {
  Plus, Edit, Trash2, Wallet, Calendar, CheckCircle, PiggyBank, Target,
  ImageIcon, Trophy, AlertCircle, ArrowRightLeft, Upload, X
} from 'lucide-react';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { AccountSelect } from '../components/common/FinanceSelects';
import { savingsGoals as goalsApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDate } from '../utils/dateFormat';

const STATUS_LABEL = { all: 'ทั้งหมด', in_progress: 'กำลังออม', completed: 'สำเร็จแล้ว', cancelled: 'ยกเลิก' };
const STATUS_COLOR = { in_progress: '#2C6488', completed: '#10b981', cancelled: '#94a3b8' };
const STATUS_BG = { in_progress: '#EAF3F7', completed: '#ecfdf5', cancelled: '#f1f5f9' };
const STATUS_FILTERS = ['all', 'in_progress', 'completed', 'cancelled'];

function getMonthsLeft(deadline) {
  if (!deadline) return 1;
  const d = new Date(deadline);
  const n = new Date();
  const diff = (d.getFullYear() - n.getFullYear()) * 12 + (d.getMonth() - n.getMonth());
  return Math.max(diff, 1);
}

const today = new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  name: '',
  image_url: '',
  target_amount: '',
  deadline: '',
  account_id: '',
};

function goalMath(goal) {
  const target = Number(goal.target_amount) || 0;
  const current = Number(goal.current_amount) || 0;
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const monthlyNeeded = Math.ceil(remaining / getMonthsLeft(goal.deadline));
  return { target, current, remaining, pct, monthlyNeeded };
}

export default function GoalsView({ accounts, onRefreshAccounts }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [imageUploading, setImageUploading] = useState(false);
  const imageInputRef = useRef(null);

  const [depositGoal, setDepositGoal] = useState(null);
  const [depositForm, setDepositForm] = useState({ from_account_id: '', amount: '', note: '', date: today });
  const [depositSaving, setDepositSaving] = useState(false);
  const [depositError, setDepositError] = useState('');
  const [justCompleted, setJustCompleted] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const assetAccounts = accounts.filter((a) => a.type === 'asset');

  const fetchGoals = async () => {
    setLoading(true);
    try { setGoals((await goalsApi.list()) || []); }
    catch { setGoals([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchGoals(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM, account_id: assetAccounts[0]?.id || '' });
    setError('');
    setImageUploading(false);
    setShowModal(true);
  };

  const openEdit = (g) => {
    setEditId(g.id);
    setForm({
      name: g.name || '',
      image_url: g.image_url || '',
      target_amount: String(g.target_amount || ''),
      deadline: g.deadline?.slice(0, 10) || '',
      account_id: g.account_id || assetAccounts[0]?.id || '',
    });
    setError('');
    setImageUploading(false);
    setShowModal(true);
  };

  const uploadGoalImage = async (file) => {
    if (!file) return;
    setImageUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('image', file);
      const uploaded = await goalsApi.uploadImage(body);
      setForm((prev) => ({ ...prev, image_url: uploaded.image_url || '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const save = async () => {
    const goalName = form.name.trim();
    if (!goalName || !form.target_amount) { setError('กรุณากรอกชื่อและยอดเป้าหมาย'); return; }
    const normalizedName = goalName.toLowerCase();
    const duplicateGoal = goals.find((g) => g.id !== editId && (g.name || '').trim().toLowerCase() === normalizedName);
    if (duplicateGoal) { setError('มีเป้าหมายชื่อนี้อยู่แล้ว'); return; }
    if (!form.account_id) { setError('กรุณาเลือกบัญชีเก็บออม เพื่อให้การฝากเงินเป็นการโอนที่ถูกต้อง'); return; }
    const targetAmount = parseFloat(form.target_amount);
    if (targetAmount <= 0) { setError('เป้าหมายต้องมากกว่า 0'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        account_id: form.account_id,
        name: goalName,
        image_url: form.image_url || null,
        target_amount: targetAmount,
        deadline: form.deadline || null,
      };
      if (editId) await goalsApi.update(editId, body);
      else await goalsApi.create(body);
      await fetchGoals();
      setShowModal(false);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async (goal) => {
    setConfirmAction({ type: 'delete', goal });
  };

  const cancelGoal = async (goal) => {
    setConfirmAction({ type: 'cancel', goal });
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
          account_id: g.account_id || null,
          name: g.name,
          image_url: g.image_url || null,
          target_amount: Number(g.target_amount),
          current_amount: Number(g.current_amount),
          deadline: g.deadline?.slice(0, 10) || null,
          status: 'cancelled',
        });
      }
      await fetchGoals();
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
    setDepositError('');
    setJustCompleted(false);
  };

  const doDeposit = async () => {
    if (!depositGoal.account_id) { setDepositError('กรุณาผูกบัญชีเก็บออมกับเป้าหมายก่อน'); return; }
    if (!depositForm.from_account_id) { setDepositError('กรุณาเลือกบัญชีต้นทาง'); return; }
    if (depositForm.from_account_id === depositGoal.account_id) { setDepositError('บัญชีต้นทางต้องไม่ใช่บัญชีเก็บออมของเป้าหมาย'); return; }
    const amount = parseFloat(depositForm.amount);
    if (!depositForm.amount || amount <= 0) { setDepositError('กรุณาใส่จำนวนเงิน'); return; }
    const sourceAccount = accounts.find((a) => a.id === depositForm.from_account_id);
    if (amount > Number(sourceAccount?.balance || 0)) {
      setDepositError(`ยอดเงินในบัญชีไม่พอ คงเหลือ ฿${fmt(sourceAccount?.balance || 0)}`);
      return;
    }
    setDepositSaving(true); setDepositError('');
    try {
      const updated = await goalsApi.deposit(depositGoal.id, {
        from_account_id: depositForm.from_account_id,
        amount,
        note: depositForm.note || null,
        date: depositForm.date || null,
      });
      if (updated.status === 'completed') setJustCompleted(true);
      await Promise.all([fetchGoals(), onRefreshAccounts?.()]);
      if (updated.status !== 'completed') setDepositGoal(null);
    } catch (err) { setDepositError(err.message); }
    finally { setDepositSaving(false); }
  };

  const inProgressGoals = goals.filter((g) => g.status === 'in_progress');
  const totalTarget = inProgressGoals.reduce((s, g) => s + Number(g.target_amount || 0), 0);
  const totalCurrent = inProgressGoals.reduce((s, g) => s + Number(g.current_amount || 0), 0);
  const totalRemaining = Math.max(0, totalTarget - totalCurrent);
  const overviewPct = totalTarget > 0 ? Math.min((totalCurrent / totalTarget) * 100, 100) : 0;
  const completed = goals.filter((g) => g.status === 'completed').length;
  const filteredGoals = statusFilter === 'all' ? goals : goals.filter((g) => g.status === statusFilter);

  return (
    <div className="p-6 space-y-5">
      {!loading && goals.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-400">เป้าหมายทั้งหมด</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{goals.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">สำเร็จแล้ว {completed} เป้าหมาย</p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-400">ยอดที่ต้องออมเพิ่มรวม</p>
              <p className="text-xl font-bold text-[#2C6488] mt-1">฿{fmt(totalRemaining)}</p>
              <p className="text-xs text-slate-400 mt-0.5">จากเป้าหมายที่กำลังออม</p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
              <p className="text-xs text-slate-400">เปอร์เซ็นต์ภาพรวม</p>
              <p className="text-2xl font-bold text-slate-800 mt-1">{overviewPct.toFixed(0)}%</p>
              <div className="w-full bg-slate-100 rounded-full h-2 mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-[#2C6488]" style={{ width: `${overviewPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-700">เป้าหมายการออม</h2>
          <p className="text-xs text-slate-400 mt-0.5">ติดตามความคืบหน้าและโอนเงินเข้าเป้าหมาย</p>
        </div>
        <button onClick={openCreate}
          className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center justify-center gap-2 font-medium">
          <Plus size={15} color="white" /> เพิ่มเป้าหมาย
        </button>
      </div>

      {!loading && goals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => {
            const active = statusFilter === status;
            const count = status === 'all' ? goals.length : goals.filter((g) => g.status === status).length;
            return (
              <button key={status} onClick={() => setStatusFilter(status)}
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
          <Target size={40} color="#cbd5e1" />
          <div>
            <p className="text-sm font-semibold text-slate-600">ยังไม่มีเป้าหมายการออม</p>
            <p className="text-xs text-slate-400 mt-1">สร้างเป้าหมายแรกเพื่อเริ่มเห็นความคืบหน้าชัดๆ</p>
          </div>
          <button onClick={openCreate}
            className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium">
            <Plus size={15} color="white" /> สร้างเป้าหมายแรก
          </button>
        </div>
      ) : filteredGoals.length === 0 ? (
        <div className="py-14 text-center text-slate-400 text-sm bg-white rounded-2xl border border-slate-100">
          ไม่มีเป้าหมายในสถานะนี้
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredGoals.map((g) => {
            const { target, current, remaining, pct, monthlyNeeded } = goalMath(g);
            const acc = accounts.find((a) => a.id === g.account_id);
            const isDone = g.status === 'completed';
            const isCancelled = g.status === 'cancelled';
            const color = STATUS_COLOR[g.status] || '#2C6488';

            return (
              <div key={g.id}
                className={`bg-white rounded-2xl shadow-sm border card-hover overflow-hidden ${isDone ? 'border-emerald-200' : 'border-slate-100'}`}>
                {g.image_url ? (
                  <div className="h-32 bg-slate-100 overflow-hidden">
                    <img src={g.image_url} alt={g.name} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-32 bg-gradient-to-br from-[#EAF3F7] to-[#EAF7E8] flex items-center justify-center">
                    <div className="w-12 h-12 rounded-2xl bg-white/80 flex items-center justify-center shadow-sm">
                      <Icon name="Target" size={24} color="#2C6488" />
                    </div>
                  </div>
                )}

                <div className="p-5">
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
                      {!isDone && !isCancelled && (
                        <button onClick={() => cancelGoal(g)}
                          title="ยกเลิกเป้าหมาย"
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-amber-100 flex items-center justify-center transition-colors">
                          <X size={12} color="#64748b" />
                        </button>
                      )}
                      <button onClick={() => remove(g)}
                        title="ลบเป้าหมาย"
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
                        <Trash2 size={12} color="#64748b" />
                      </button>
                    </div>
                  </div>

                  <div className="w-full bg-slate-100 rounded-full h-3 mb-3 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: isDone ? '#10b981' : '#2C6488' }} />
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-slate-50 rounded-xl px-3 py-2">
                      <p className="text-[11px] text-slate-400">ออมแล้ว</p>
                      <p className="text-sm font-bold text-slate-700 mt-0.5">฿{fmt(current)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl px-3 py-2">
                      <p className="text-[11px] text-slate-400">เป้าหมาย</p>
                      <p className="text-sm font-bold text-slate-700 mt-0.5">฿{fmt(target)}</p>
                    </div>
                    <div className="bg-[#EAF3F7] rounded-xl px-3 py-2 border border-[#DCE8EE]">
                      <p className="text-[11px] text-[#6F9DB6]">คงเหลือ</p>
                      <p className="text-sm font-bold text-[#25536F] mt-0.5">฿{fmt(remaining)}</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400">ต้องออมต่อเดือน</span>
                      <span className="font-semibold text-slate-700">฿{fmt(monthlyNeeded)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {acc ? (
                        <div className="flex items-center gap-1 text-slate-500 bg-slate-50 rounded-xl px-2.5 py-2">
                          <Wallet size={11} color="#2C6488" />
                          {acc.name} · ฿{fmt(acc.balance)}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-amber-600 bg-amber-50 rounded-xl px-2.5 py-2">
                          <AlertCircle size={11} color="#d97706" />
                          ยังไม่ผูกบัญชีเก็บออม
                        </div>
                      )}
                      {g.deadline && (
                        <div className="flex items-center gap-1 text-slate-400 bg-slate-50 rounded-xl px-2.5 py-2">
                          <Calendar size={11} color="#94a3b8" />
                          {formatDisplayDate(g.deadline)}
                        </div>
                      )}
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
                    <button onClick={() => openDeposit(g)} disabled={!g.account_id || assetAccounts.filter((a) => a.id !== g.account_id).length === 0}
                      className="w-full mt-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#2C6488] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
                      <span className="flex items-center justify-center gap-2">
                        <PiggyBank size={15} color="white" />
                        {g.account_id ? 'ฝากเงินเข้าเป้าหมาย' : 'ผูกบัญชีก่อนฝากเงิน'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <Modal title={editId ? 'แก้ไขเป้าหมาย' : 'เพิ่มเป้าหมายใหม่'} onClose={() => setShowModal(false)} size="lg">
          <div className="space-y-4 max-h-[75vh] overflow-y-auto p-1">
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}
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

            <section className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase">แผนออม</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">เป้าหมาย (฿)</label>
                  <input type="number" min="0" value={form.target_amount}
                    onChange={(e) => setForm({ ...form, target_amount: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่เป้าหมาย</label>
                  <input type="date" value={form.deadline}
                    onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                </div>
              </div>
            </section>

            <section className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase">บัญชีเก็บออม</p>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">บัญชีที่จะรับเงินเข้าเป้าหมาย</label>
                <AccountSelect
                  value={form.account_id}
                  onChange={(v) => setForm({ ...form, account_id: v })}
                  accounts={assetAccounts}
                  placeholder="เลือกบัญชีเก็บออม"
                />
                <p className="text-xs text-slate-400 mt-1">เวลาฝากเงิน ระบบจะบันทึกเป็นการโอนเข้าบัญชีนี้</p>
              </div>
            </section>

            <section className="space-y-3 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-500 uppercase">รูปภาพ</p>
              <div className="h-32 rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden flex items-center justify-center">
                {form.image_url ? (
                  <img src={form.image_url} alt="ตัวอย่างรูปเป้าหมาย" className="w-full h-full object-cover" />
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
                  className="px-4 py-2.5 rounded-xl border border-[#DCE8EE] bg-[#EAF3F7] text-[#2C6488] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
                  <Upload size={14} color="#2C6488" />
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
        <Modal title={`โอนเงินเข้าเป้าหมาย — ${depositGoal.name}`} onClose={() => setDepositGoal(null)}>
          <div className="space-y-4">
            {justCompleted ? (
              <div className="py-6 flex flex-col items-center gap-3 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Trophy size={34} color="#10b981" />
                </div>
                <p className="text-lg font-bold text-slate-800">บรรลุเป้าหมายแล้ว</p>
                <p className="text-sm text-slate-500">{depositGoal.name} ครบตามเป้าหมายแล้ว</p>
                <button onClick={() => setDepositGoal(null)}
                  className="mt-2 px-6 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold">
                  ปิด
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const g = goals.find((x) => x.id === depositGoal.id) || depositGoal;
                  const { current, target, remaining, pct } = goalMath(g);
                  return (
                    <div className="bg-slate-50 rounded-xl p-3">
                      <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>ออมแล้ว ฿{fmt(current)}</span>
                        <span>เหลือ ฿{fmt(remaining)} · {pct.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div className="h-full rounded-full bg-[#2C6488]" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">เป้าหมาย ฿{fmt(target)}</p>
                    </div>
                  );
                })()}

                {depositError && (
                  <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{depositError}</p>
                )}

                {!depositGoal.account_id ? (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">
                    เป้าหมายนี้ยังไม่ผูกบัญชีเก็บออม กรุณาแก้ไขเป้าหมายและเลือกบัญชีก่อนฝากเงิน
                  </div>
                ) : (
                  <div className="bg-[#EAF3F7] border border-[#DCE8EE] rounded-xl p-3 text-sm text-[#25536F] flex items-center gap-2">
                    <ArrowRightLeft size={16} color="#2C6488" />
                    การฝากเงินนี้จะถูกบันทึกเป็นรายการโอนเงินเข้าเป้าหมาย
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">โอนจากบัญชี</label>
                  <AccountSelect
                    value={depositForm.from_account_id}
                    onChange={(v) => setDepositForm({ ...depositForm, from_account_id: v })}
                    accounts={assetAccounts.filter((a) => a.id !== depositGoal.account_id)}
                    placeholder="เลือกบัญชีต้นทาง"
                  />
                  {depositGoal.account_id && (
                    <p className="text-xs text-slate-400 mt-1">
                      เข้า: {accounts.find((a) => a.id === depositGoal.account_id)?.name || '?'} (฿{fmt(accounts.find((a) => a.id === depositGoal.account_id)?.balance || 0)})
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">จำนวนเงิน (฿)</label>
                  <input type="number" value={depositForm.amount} placeholder="0.00" min="0"
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700 text-lg font-bold" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
                    <input type="date" value={depositForm.date}
                      onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
                    <input value={depositForm.note} placeholder="ไม่บังคับ"
                      onChange={(e) => setDepositForm({ ...depositForm, note: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button onClick={() => setDepositGoal(null)}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium">
                    ยกเลิก
                  </button>
                  <button onClick={doDeposit} disabled={depositSaving || !depositGoal.account_id}
                    className="flex-1 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 bg-[#2C6488]">
                    <PiggyBank size={15} color="white" />
                    {depositSaving ? 'กำลังบันทึก...' : 'โอนเข้าเป้าหมาย'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === 'cancel' ? 'ยกเลิกเป้าหมาย' : 'ลบเป้าหมาย'}
        message={confirmAction?.type === 'cancel'
          ? `ต้องการยกเลิกเป้าหมาย "${confirmAction?.goal?.name || ''}" ใช่ไหม? เป้าหมายจะยังอยู่ในประวัติแต่ฝากเงินต่อไม่ได้`
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
