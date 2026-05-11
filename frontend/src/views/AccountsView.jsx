import { useState } from 'react';
import { DollarSign, Briefcase, Star, Smartphone, TrendingUp, CreditCard, Tag, Edit, Trash2, Share2, Plus, X } from 'lucide-react';
import Modal from '../components/common/Modal';
import { accounts as accountsApi, transactions as txApi } from '../services/api';
import { fmt } from '../constants/data';

const todayStr = () => new Date().toISOString().slice(0, 10);

// ─── Kind metadata (with type tag) ────────────────────────────────────────────
const KINDS = [
  { value: 'cash',         label: 'เงินสด',      icon: 'DollarSign', color: '#10b981', type: 'asset' },
  { value: 'bank_account', label: 'บัญชีธนาคาร', icon: 'Briefcase',  color: '#3b82f6', type: 'asset' },
  { value: 'savings',      label: 'ออมทรัพย์',    icon: 'Star',       color: '#f59e0b', type: 'asset' },
  { value: 'e_wallet',     label: 'E-Wallet',     icon: 'Smartphone', color: '#3b82f6', type: 'asset' },
  { value: 'investment',   label: 'การลงทุน',     icon: 'TrendingUp', color: '#8b5cf6', type: 'asset' },
  { value: 'credit_card',  label: 'บัตรเครดิต',   icon: 'CreditCard', color: '#ef4444', type: 'liability' },
  { value: 'loan',         label: 'เงินกู้',      icon: 'Tag',        color: '#f97316', type: 'liability' },
];
const ASSET_KINDS     = KINDS.filter((k) => k.type === 'asset');
const LIABILITY_KINDS = KINDS.filter((k) => k.type === 'liability');
const getKind = (v) => KINDS.find((k) => k.value === v) || KINDS[0];

const TYPES = [
  { value: 'asset',     label: 'สินทรัพย์', color: '#10b981', bg: '#f0fdf4' },
  { value: 'liability', label: 'หนี้สิน',    color: '#ef4444', bg: '#fff1f2' },
];

const emptyForm = () => ({ name: '', type: 'asset', kind: 'cash', balance: '', currency: 'THB' });
const newPoolRow = () => ({ id: Date.now() + Math.random(), kind: 'cash', name: '', balance: '' });

// ─── KindIcon helper ──────────────────────────────────────────────────────────
function KindIcon({ icon, color, size = 18 }) {
  if (icon === 'DollarSign')  return <DollarSign  size={size} color={color} />;
  if (icon === 'Briefcase')   return <Briefcase   size={size} color={color} />;
  if (icon === 'Star')        return <Star        size={size} color={color} />;
  if (icon === 'Smartphone')  return <Smartphone  size={size} color={color} />;
  if (icon === 'TrendingUp')  return <TrendingUp  size={size} color={color} />;
  if (icon === 'CreditCard')  return <CreditCard  size={size} color={color} />;
  if (icon === 'Tag')         return <Tag         size={size} color={color} />;
  return null;
}


// ─── Main View ────────────────────────────────────────────────────────────────
export default function AccountsView({ accounts, onRefresh }) {
  // Add / Edit account modal
  const [showModal, setShowModal]       = useState(false);
  const [editId, setEditId]             = useState(null);
  const [editOrigBalance, setEditOrigBalance] = useState(0); // original balance before edit
  const [form, setForm]                 = useState(emptyForm());
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');

  // Pool-add modal (เพิ่มบัญชีสินทรัพย์แบบกองเงิน)
  const [showPoolAdd, setShowPoolAdd]   = useState(false);
  const [poolAddAmount, setPoolAddAmount] = useState('');
  const [poolAddRows, setPoolAddRows]   = useState([newPoolRow()]);
  const [poolAddSaving, setPoolAddSaving] = useState(false);
  const [poolAddError, setPoolAddError] = useState('');

  // Distribute ("แจกจ่ายเข้าบัญชี") modal
  const [showDist, setShowDist]         = useState(false);
  const [poolAmount, setPoolAmount]     = useState('');
  const [distDate, setDistDate]         = useState(todayStr());
  const [distNote, setDistNote]         = useState('');
  const [allocations, setAllocations]   = useState([]);
  const [distSaving, setDistSaving]     = useState(false);
  const [distError, setDistError]       = useState('');

  const assetAccounts = accounts.filter((a) => a.type === 'asset');
  const liabAccounts  = accounts.filter((a) => a.type === 'liability');

  const totalAssets = assetAccounts.reduce((s, a) => s + a.balance, 0);
  const totalLiab   = liabAccounts.reduce((s, a)  => s + a.balance, 0);
  const netWorth    = totalAssets - totalLiab;

  // ── Pool-add helpers ────────────────────────────────────────────────────────
  const openPoolAdd = () => {
    setPoolAddAmount('');
    setPoolAddRows([newPoolRow()]);
    setPoolAddError('');
    setShowPoolAdd(true);
  };

  const addPoolRow = () => setPoolAddRows((r) => [...r, newPoolRow()]);

  const removePoolRow = (id) => setPoolAddRows((r) => r.filter((x) => x.id !== id));

  const setPoolRowField = (id, field, value) =>
    setPoolAddRows((r) => r.map((x) => x.id === id ? { ...x, [field]: value } : x));

  // Derived pool values
  const poolAmt       = parseFloat(poolAddAmount) || 0;
  const poolAllocated = poolAddRows.reduce((s, r) => s + (parseFloat(r.balance) || 0), 0);
  const poolRemaining = poolAmt - poolAllocated;
  const poolPct       = poolAmt > 0 ? Math.min((poolAllocated / poolAmt) * 100, 100) : 0;
  const poolOver      = poolRemaining < -0.005;
  const poolDone      = poolAmt > 0 && Math.abs(poolRemaining) < 0.005;

  const fillPoolRemaining = (id) => {
    if (poolRemaining <= 0) return;
    const cur = parseFloat(poolAddRows.find((r) => r.id === id)?.balance) || 0;
    setPoolRowField(id, 'balance', String(cur + poolRemaining));
  };

  const savePoolAdd = async () => {
    if (poolAmt <= 0) { setPoolAddError('กรุณาใส่ยอดเงินกองก่อน'); return; }
    const validRows = poolAddRows.filter((r) => r.name.trim() && parseFloat(r.balance) > 0);
    if (validRows.length === 0) { setPoolAddError('กรุณาเพิ่มบัญชีอย่างน้อย 1 บัญชีและใส่ยอดเงิน'); return; }
    if (poolOver) { setPoolAddError(`ยอดรวมเกินกองเงิน: เกิน ฿${fmt(Math.abs(poolRemaining))}`); return; }
    const emptyName = poolAddRows.find((r) => parseFloat(r.balance) > 0 && !r.name.trim());
    if (emptyName) { setPoolAddError('กรุณาใส่ชื่อบัญชีให้ครบทุกแถว'); return; }

    setPoolAddSaving(true);
    setPoolAddError('');
    try {
      for (const row of validRows) {
        const bal = parseFloat(row.balance);
        const created = await accountsApi.create({
          name: row.name.trim(), type: 'asset', kind: row.kind,
          balance: bal, currency: 'THB',
        });
        if (created?.id) {
          await txApi.create({
            type: 'adjustment', amount: bal, account_id: created.id,
            transaction_date: todayStr(), note: 'ยอดเริ่มต้น',
          }).catch(() => {});
        }
      }
      await onRefresh();
      setShowPoolAdd(false);
    } catch (err) {
      setPoolAddError(err.message);
    } finally {
      setPoolAddSaving(false);
    }
  };

  // ── Add / Edit account ─────────────────────────────────────────────────────
  const openAdd = (presetType = 'liability') => {
    setEditId(null);
    setForm({ ...emptyForm(), type: presetType, kind: presetType === 'liability' ? 'credit_card' : 'cash' });
    setError('');
    setShowModal(true);
  };

  const openEdit = (acc) => {
    setEditId(acc.id);
    setEditOrigBalance(acc.balance);
    setForm({ name: acc.name, type: acc.type, kind: acc.kind, balance: String(acc.balance), currency: acc.currency });
    setError('');
    setShowModal(true);
  };

  const handleTypeChange = (type) => {
    // Auto-select first valid kind when type switches
    const firstKind = (type === 'asset' ? ASSET_KINDS : LIABILITY_KINDS)[0];
    setForm((f) => ({ ...f, type, kind: firstKind.value }));
  };

  const save = async () => {
    if (!form.name.trim()) { setError('กรุณาใส่ชื่อบัญชี'); return; }
    setSaving(true);
    setError('');
    try {
      const newBalance = parseFloat(form.balance) || 0;
      const body = {
        name: form.name, type: form.type, kind: form.kind,
        balance: newBalance, currency: form.currency,
      };

      if (editId) {
        // แก้ไขบัญชี
        await accountsApi.update(editId, body);
        // สร้าง adjustment transaction ถ้า balance เปลี่ยน
        const diff = newBalance - editOrigBalance;
        if (Math.abs(diff) >= 0.01) {
          await txApi.create({
            type:             'adjustment',
            amount:           Math.abs(diff),
            account_id:       editId,
            transaction_date: todayStr(),
            note:             diff > 0
              ? `ปรับยอดเพิ่ม (${editOrigBalance.toLocaleString()} → ${newBalance.toLocaleString()})`
              : `ปรับยอดลด (${editOrigBalance.toLocaleString()} → ${newBalance.toLocaleString()})`,
          }).catch(() => {}); // ไม่ให้ error ของ adjustment หยุด flow หลัก
        }
      } else {
        // สร้างบัญชีใหม่
        const created = await accountsApi.create(body);
        // สร้าง adjustment transaction สำหรับยอดเริ่มต้น
        if (newBalance > 0 && created?.id) {
          await txApi.create({
            type:             'adjustment',
            amount:           newBalance,
            account_id:       created.id,
            transaction_date: todayStr(),
            note:             'ยอดเริ่มต้น',
          }).catch(() => {});
        }
      }

      await onRefresh();
      setShowModal(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('ต้องการลบบัญชีนี้?')) return;
    try {
      await accountsApi.delete(id);
      await onRefresh();
    } catch (err) { alert(err.message); }
  };

  // ── Distribute ──────────────────────────────────────
  const openDist = () => {
    setPoolAmount('');
    setDistDate(todayStr());
    setDistNote('');
    setDistError('');
    setAllocations(assetAccounts.map((a) => ({ account_id: a.id, name: a.name, kind: a.kind, amount: '' })));
    setShowDist(true);
  };

  const setAlloc = (idx, val) => {
    setAllocations((prev) => prev.map((a, i) => i === idx ? { ...a, amount: val } : a));
  };

  // Derived values for distribute modal
  const pool       = parseFloat(poolAmount) || 0;
  const allocated  = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const remaining  = pool - allocated;
  const distValid  = pool > 0 && Math.abs(remaining) < 0.01;

  const saveDist = async () => {
    if (pool <= 0)     { setDistError('กรุณาใส่ยอดเงินที่ต้องการกอง'); return; }
    if (!distValid)    { setDistError(`ยอดยังไม่ครบ: เหลืออีก ฿${fmt(Math.abs(remaining))}`); return; }

    const lines = allocations.filter((a) => parseFloat(a.amount) > 0);
    if (lines.length === 0) { setDistError('กรุณาใส่ยอดอย่างน้อย 1 บัญชี'); return; }

    setDistSaving(true);
    setDistError('');
    try {
      await Promise.all(
        lines.map((a) =>
          txApi.create({
            type:             'income',
            amount:           parseFloat(a.amount),
            account_id:       a.account_id,
            transaction_date: distDate,
            note:             distNote || 'กระจายเงินเข้ากระเป๋า',
          })
        )
      );
      await onRefresh();
      setShowDist(false);
    } catch (err) {
      setDistError(err.message);
    } finally {
      setDistSaving(false);
    }
  };

  // Distribute remaining into a single account (quick fill helper)
  const fillRemaining = (idx) => {
    if (remaining <= 0) return;
    setAlloc(idx, String((parseFloat(allocations[idx].amount) || 0) + remaining));
  };

  // ── Render helpers ─────────────────────────────────────────────────────────
const AccountCard = ({ acc, liab }) => {
    const k = getKind(acc.kind);
    return (
      <div className={`bg-white rounded-2xl p-5 shadow-sm border card-hover ${liab ? 'border-red-100' : 'border-slate-100'}`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: k.color + '18' }}>
              <KindIcon icon={k.icon} color={k.color} size={22} />
            </div>
            <div>
              <p className="font-semibold text-slate-800">{acc.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{k.label}</p>
            </div>
          </div>
          <div className="flex gap-1">
            <button onClick={() => openEdit(acc)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors">
              <Edit size={12} color="#64748b" />
            </button>
            <button onClick={() => remove(acc.id)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
              <Trash2 size={12} color="#94a3b8" />
            </button>
          </div>
        </div>
        <p className={`text-2xl font-bold ${liab ? 'text-red-500' : 'text-emerald-600'}`}>฿{fmt(acc.balance)}</p>
        <p className="text-xs text-slate-400 mt-0.5">{acc.currency}</p>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-5">

      {/* ── Summary ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: 'มูลค่าสุทธิ',
            value: netWorth,
            color: netWorth >= 0 ? '#3b82f6' : '#ef4444',
            bg:    netWorth >= 0 ? '#eff6ff' : '#fff1f2',
          },
          { label: 'สินทรัพย์รวม', value: totalAssets, color: '#10b981', bg: '#f0fdf4' },
          { label: 'หนี้สินรวม',   value: totalLiab,   color: '#ef4444', bg: '#fff1f2' },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl p-4 card-hover border" style={{ background: s.bg, borderColor: s.color + '40' }}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>
              {s.value < 0 ? '-' : ''}฿{fmt(s.value)}
            </p>
          </div>
        ))}
      </div>

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-700">บัญชีทั้งหมด</h2>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* 1. Add asset — pool flow (green) */}
          <button onClick={openPoolAdd}
            className="text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium border-2 transition-colors"
            style={{ color: '#059669', borderColor: '#6ee7b7', background: '#ecfdf5' }}>
            <Plus size={15} color="#059669" /> เพิ่มบัญชีสินทรัพย์
          </button>
          {/* 2. Add liability */}
          <button onClick={() => openAdd('liability')}
            className="text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium border-2 transition-colors"
            style={{ color: '#ef4444', borderColor: '#fecaca', background: '#fff1f2' }}>
            <Plus size={15} color="#ef4444" /> เพิ่มหนี้สิน
          </button>
          {/* 3. Distribute — only if at least 1 asset account */}
          {assetAccounts.length > 0 && (
            <button onClick={openDist}
              className="text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium border-2 transition-colors"
              style={{ color: '#3b82f6', borderColor: '#bfdbfe', background: '#eff6ff' }}>
              <Share2 size={15} color="#3b82f6" />
              แบ่งเงินเข้าบัญชี
            </button>
          )}
        </div>
      </div>

      {/* ── Asset accounts ────────────────────────────────────────────────────── */}
      {assetAccounts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-3">สินทรัพย์</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {assetAccounts.map((acc) => <AccountCard key={acc.id} acc={acc} />)}
          </div>
        </div>
      )}

      {/* ── Liability accounts ────────────────────────────────────────────────── */}
      {liabAccounts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-3">หนี้สิน</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {liabAccounts.map((acc) => <AccountCard key={acc.id} acc={acc} liab />)}
          </div>
        </div>
      )}

      {accounts.length === 0 && (
        <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
          <Briefcase size={40} color="#cbd5e1" />
          <p className="text-sm">ยังไม่มีบัญชี กดเพิ่มบัญชีด้านบน</p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          Modal: เพิ่ม / แก้ไขบัญชี
      ══════════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <Modal title={editId ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

            {/* Kind selector (liability only) */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">ชนิดบัญชี</label>
              <div className="grid grid-cols-2 gap-2">
                {LIABILITY_KINDS.map((k) => (
                  <button key={k.value} onClick={() => setForm({ ...form, kind: k.value })}
                    className="flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all"
                    style={{
                      borderColor: form.kind === k.value ? k.color : '#e2e8f0',
                      background:  form.kind === k.value ? k.color + '15' : '#f8fafc',
                    }}>
                    <KindIcon icon={k.icon} color={form.kind === k.value ? k.color : '#94a3b8'} />
                    <span className="text-xs leading-tight text-center"
                      style={{ color: form.kind === k.value ? k.color : '#64748b' }}>
                      {k.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Name */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อบัญชี</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น กระเป๋าเงินส่วนตัว"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            {/* Balance */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ยอดเงิน (฿)</label>
              <input type="number" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })}
                placeholder="0.00"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
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

      {/* ═══════════════════════════════════════════════════════════════════════
          Modal: เพิ่มบัญชีสินทรัพย์ (แบบกองเงิน)
      ══════════════════════════════════════════════════════════════════════════ */}
      {showPoolAdd && (
        <Modal title="เพิ่มบัญชีสินทรัพย์" onClose={() => setShowPoolAdd(false)}>
          <div className="space-y-4">
            {poolAddError && (
              <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{poolAddError}</p>
            )}

            {/* Pool amount */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ยอดเงินทั้งหมดที่มี (฿)</label>
              <input
                type="number" min="0" value={poolAddAmount}
                onChange={(e) => setPoolAddAmount(e.target.value)}
                placeholder="เช่น 150000"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700 font-bold" />
            </div>

            {/* Progress bar */}
            {poolAmt > 0 && (
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-slate-500 font-medium">กองเงินที่เหลือ</span>
                  <span className={`font-bold text-sm ${poolOver ? 'text-red-500' : poolDone ? 'text-emerald-600' : 'text-blue-600'}`}>
                    ฿{fmt(Math.abs(poolRemaining))}
                    {poolOver && <span className="text-xs font-normal ml-1 text-red-400">(เกิน!)</span>}
                    {poolDone && <span className="text-xs font-normal ml-1 text-emerald-400"> ✓ จัดสรรครบ</span>}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${poolOver ? 'bg-red-400' : poolDone ? 'bg-emerald-400' : 'bg-blue-400'}`}
                    style={{ width: `${poolPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs mt-1.5 text-slate-400">
                  <span>จัดสรรแล้ว ฿{fmt(poolAllocated)}</span>
                  <span>จากกอง ฿{fmt(poolAmt)}</span>
                </div>
              </div>
            )}

            {/* Account rows */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-500">รายการบัญชีที่ต้องการสร้าง</label>
                <button onClick={addPoolRow}
                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
                  style={{ color: '#3b82f6', background: '#eff6ff' }}>
                  <Plus size={12} color="#3b82f6" /> เพิ่มบัญชี
                </button>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {poolAddRows.map((row, idx) => {
                  const k = getKind(row.kind);
                  return (
                    <div key={row.id} className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                      {/* Row header */}
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-xs font-semibold text-slate-500">บัญชีที่ {idx + 1}</span>
                        {poolAddRows.length > 1 && (
                          <button onClick={() => removePoolRow(row.id)}
                            className="w-5 h-5 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors">
                            <X size={10} color="#ef4444" />
                          </button>
                        )}
                      </div>

                      {/* Kind selector */}
                      <div className="grid grid-cols-5 gap-1.5 mb-2.5">
                        {ASSET_KINDS.map((ak) => (
                          <button key={ak.value} onClick={() => setPoolRowField(row.id, 'kind', ak.value)}
                            className="flex flex-col items-center gap-0.5 p-1.5 rounded-xl border-2 transition-all"
                            style={{
                              borderColor: row.kind === ak.value ? ak.color : '#e2e8f0',
                              background:  row.kind === ak.value ? ak.color + '15' : 'white',
                            }}>
                            <KindIcon icon={ak.icon} color={row.kind === ak.value ? ak.color : '#94a3b8'} size={16} />
                            <span className="text-[10px] leading-tight text-center"
                              style={{ color: row.kind === ak.value ? ak.color : '#94a3b8' }}>
                              {ak.label}
                            </span>
                          </button>
                        ))}
                      </div>

                      {/* Name + Balance */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-medium text-slate-400 mb-0.5 block">ชื่อบัญชี</label>
                          <input
                            value={row.name}
                            onChange={(e) => setPoolRowField(row.id, 'name', e.target.value)}
                            placeholder={`เช่น ${k.label}`}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm bg-white text-slate-700" />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium text-slate-400 mb-0.5 block">ยอดเงิน (฿)</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min="0"
                              value={row.balance}
                              onChange={(e) => setPoolRowField(row.id, 'balance', e.target.value)}
                              placeholder="0"
                              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-right bg-white text-slate-700 font-medium" />
                            {poolAmt > 0 && poolRemaining > 0.005 && (
                              <button onClick={() => fillPoolRemaining(row.id)}
                                title="เติมยอดที่เหลือในกอง"
                                className="w-7 h-7 rounded-lg bg-blue-50 hover:bg-blue-100 flex items-center justify-center flex-shrink-0 transition-colors">
                                <Plus size={12} color="#3b82f6" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowPoolAdd(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                ยกเลิก
              </button>
              <button onClick={savePoolAdd} disabled={poolAddSaving}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60">
                {poolAddSaving
                  ? 'กำลังสร้าง...'
                  : `สร้าง ${poolAddRows.filter(r => r.name.trim()).length} บัญชี`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          Modal: แบ่งเงินเข้าบัญชี
      ══════════════════════════════════════════════════════════════════════════ */}
      {showDist && (
        <Modal title="แบ่งเงินเข้าบัญชี" onClose={() => setShowDist(false)}>
          <div className="space-y-4">
            {distError && (
              <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{distError}</p>
            )}

            {/* Pool amount + date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">ยอดเงินที่กอง (฿)</label>
                <input
                  type="number" min="0" value={poolAmount}
                  onChange={(e) => setPoolAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700 font-bold text-lg" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
                <input type="date" value={distDate} onChange={(e) => setDistDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
            </div>

            {/* Note */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
              <input value={distNote} onChange={(e) => setDistNote(e.target.value)}
                placeholder="เช่น เงินเดือน เมษายน"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            {/* Progress bar */}
            {pool > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-500">จัดสรรแล้ว</span>
                  <span className={`font-semibold ${distValid ? 'text-emerald-600' : remaining < 0 ? 'text-red-500' : 'text-blue-500'}`}>
                    ฿{fmt(allocated)} / ฿{fmt(pool)}
                    {!distValid && remaining !== 0 && (
                      <span className="ml-2 font-normal text-slate-400">
                        ({remaining > 0 ? `เหลือ +฿${fmt(remaining)}` : `เกิน -฿${fmt(Math.abs(remaining))}`})
                      </span>
                    )}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${remaining < 0 ? 'bg-red-400' : distValid ? 'bg-emerald-400' : 'bg-blue-400'}`}
                    style={{ width: `${Math.min((allocated / pool) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Account allocation list */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">
                โยนเข้าบัญชี (สินทรัพย์เท่านั้น)
              </label>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {allocations.map((alloc, idx) => {
                  const k = getKind(alloc.kind);
                  return (
                    <div key={alloc.account_id}
                      className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                      {/* Icon */}
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: k.color + '18' }}>
                        <KindIcon icon={k.icon} color={k.color} />
                      </div>
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{alloc.name}</p>
                        <p className="text-xs text-slate-400">{k.label}</p>
                      </div>
                      {/* Amount input */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-sm text-slate-400">฿</span>
                        <input
                          type="number" min="0" value={alloc.amount}
                          onChange={(e) => setAlloc(idx, e.target.value)}
                          placeholder="0"
                          className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right bg-white text-slate-700 font-medium" />
                        {/* Fill remaining shortcut */}
                        {pool > 0 && remaining > 0 && (
                          <button onClick={() => fillRemaining(idx)}
                            title="เติมยอดที่เหลือ"
                            className="w-6 h-6 rounded-lg bg-blue-50 hover:bg-blue-100 flex items-center justify-center transition-colors flex-shrink-0">
                            <Plus size={11} color="#3b82f6" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowDist(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                ยกเลิก
              </button>
              <button
                onClick={saveDist}
                disabled={distSaving || !distValid}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
                {distSaving ? 'กำลังบันทึก...' : `โยน ฿${fmt(pool)} เข้ากระเป๋า`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
