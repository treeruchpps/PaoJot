import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DollarSign, Briefcase, Star, Smartphone, TrendingUp, Edit, Trash2, Share2, Plus, X, ChevronDown } from 'lucide-react';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { accounts as accountsApi, transactions as txApi } from '../services/api';
import { fmt } from '../constants/data';

const todayStr = () => new Date().toISOString().slice(0, 10);

// ─── Kind metadata ────────────────────────────────────────────────────────────
const KINDS = [
  { value: 'cash',         label: 'เงินสด',      icon: 'DollarSign', color: '#10b981', type: 'asset' },
  { value: 'bank_account', label: 'บัญชีธนาคาร', icon: 'Briefcase',  color: '#2C6488', type: 'asset' },
  { value: 'savings',      label: 'ออมทรัพย์',    icon: 'Star',       color: '#f59e0b', type: 'asset' },
  { value: 'e_wallet',     label: 'E-Wallet',     icon: 'Smartphone', color: '#2C6488', type: 'asset' },
  { value: 'investment',   label: 'การลงทุน',     icon: 'TrendingUp', color: '#5F9A7A', type: 'asset' },
];
const ASSET_KINDS     = KINDS.filter((k) => k.type === 'asset');
const getKind = (v) => KINDS.find((k) => k.value === v) || KINDS[0];

const emptyForm = () => ({
  name: '', type: 'asset', kind: 'cash', balance: '', currency: 'THB',
});
const newPoolRow = () => ({ id: Date.now() + Math.random(), kind: 'cash', name: '', balance: '' });

// ─── KindIcon helper ──────────────────────────────────────────────────────────
function KindIcon({ icon, color, size = 18 }) {
  if (icon === 'DollarSign')  return <DollarSign  size={size} color={color} />;
  if (icon === 'Briefcase')   return <Briefcase   size={size} color={color} />;
  if (icon === 'Star')        return <Star        size={size} color={color} />;
  if (icon === 'Smartphone')  return <Smartphone  size={size} color={color} />;
  if (icon === 'TrendingUp')  return <TrendingUp  size={size} color={color} />;
  return null;
}

function AssetKindDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const ref = useRef(null);
  const selected = getKind(value);

  useEffect(() => {
    if (!open || !ref.current) return;
    const updatePosition = () => {
      const rect = ref.current.getBoundingClientRect();
      const menuHeight = ASSET_KINDS.length * 44 + 8;
      const bottomSpace = window.innerHeight - rect.bottom;
      const topSpace = rect.top;
      const shouldDropUp = bottomSpace < menuHeight && topSpace > menuHeight;
      setDropUp(shouldDropUp);
      setMenuStyle({
        position: 'fixed',
        left: rect.left,
        top: shouldDropUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
        width: rect.width,
        zIndex: 1000,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full h-9 border border-slate-200 rounded-lg px-2.5 text-sm bg-slate-50 text-slate-700 flex items-center gap-2 hover:border-[#BFD8E4] transition-colors">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: selected.color + '18' }}>
          <KindIcon icon={selected.icon} color={selected.color} size={14} />
        </span>
        <span className="flex-1 text-left truncate">{selected.label}</span>
        <ChevronDown size={13} color="#94a3b8" />
      </button>

      {open && createPortal(
        <div style={menuStyle} className={`bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden ${dropUp ? 'origin-bottom' : 'origin-top'}`}>
          {ASSET_KINDS.map((kind) => (
            <button key={kind.value} type="button"
              onClick={() => { onChange(kind.value); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm hover:bg-slate-50 transition-colors"
              style={{ background: value === kind.value ? kind.color + '10' : undefined }}>
              <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: kind.color + '18' }}>
                <KindIcon icon={kind.icon} color={kind.color} size={15} />
              </span>
              <span className="flex-1 text-left font-medium text-slate-700">{kind.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export default function AccountsView({ accounts, onRefresh }) {
  // Add / Edit account modal
  const [showModal, setShowModal]             = useState(false);
  const [editId, setEditId]                   = useState(null);
  const [form, setForm]                       = useState(emptyForm());
  const [saving, setSaving]                   = useState(false);
  const [error, setError]                     = useState('');

  // Pool-add modal
  const [showPoolAdd, setShowPoolAdd]       = useState(false);
  const [poolAddAmount, setPoolAddAmount]   = useState('');
  const [poolAddRows, setPoolAddRows]       = useState([newPoolRow()]);
  const [poolAddSaving, setPoolAddSaving]   = useState(false);
  const [poolAddError, setPoolAddError]     = useState('');

  // Distribute modal
  const [showDist, setShowDist]       = useState(false);
  const [poolAmount, setPoolAmount]   = useState('');
  const [distDate, setDistDate]       = useState(todayStr());
  const [distNote, setDistNote]       = useState('');
  const [allocations, setAllocations] = useState([]);
  const [distSaving, setDistSaving]   = useState(false);
  const [distError, setDistError]     = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const assetAccounts = accounts.filter((a) => a.type === 'asset');
  const totalAssets = assetAccounts.reduce((s, a) => s + a.balance, 0);

  // ── Pool-add helpers ───────────────────────────────────────────────────────
  const openPoolAdd = () => {
    setPoolAddAmount(''); setPoolAddRows([newPoolRow()]); setPoolAddError(''); setShowPoolAdd(true);
  };
  const addPoolRow    = () => setPoolAddRows((r) => [...r, newPoolRow()]);
  const removePoolRow = (id) => setPoolAddRows((r) => r.filter((x) => x.id !== id));
  const setPoolRowField = (id, field, value) =>
    setPoolAddRows((r) => r.map((x) => x.id === id ? { ...x, [field]: value } : x));

  const poolAmt       = parseFloat(poolAddAmount) || 0;
  const poolAllocated = poolAddRows.reduce((s, r) => s + (parseFloat(r.balance) || 0), 0);
  const poolRemaining = poolAmt - poolAllocated;
  const poolPct       = poolAmt > 0 ? Math.min((poolAllocated / poolAmt) * 100, 100) : 0;
  const poolOver      = poolRemaining < -0.005;
  const poolDone      = poolAmt > 0 && Math.abs(poolRemaining) < 0.005;
  const poolNamedRows = poolAddRows.filter((r) => r.name.trim()).length;
  const poolSaveLabel = poolAddSaving
    ? 'กำลังสร้าง...'
    : poolAmt <= 0
      ? 'ใส่ยอดรวมก่อน'
      : poolOver
        ? `ยอดเกิน ฿${fmt(Math.abs(poolRemaining))}`
        : poolDone
          ? `สร้าง ${poolNamedRows} บัญชี`
          : `เหลือ ฿${fmt(Math.abs(poolRemaining))}`;

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
    setPoolAddSaving(true); setPoolAddError('');
    try {
      for (const row of validRows) {
        const bal = parseFloat(row.balance);
        const created = await accountsApi.create({
          name: row.name.trim(), type: 'asset', kind: row.kind, balance: bal, currency: 'THB',
        });
        if (created?.id) {
          await txApi.create({
            type: 'adjustment', amount: bal, account_id: created.id,
            transaction_date: todayStr(), note: 'ยอดเริ่มต้น',
          }).catch(() => {});
        }
      }
      await onRefresh(); setShowPoolAdd(false);
    } catch (err) { setPoolAddError(err.message); }
    finally { setPoolAddSaving(false); }
  };

  // ── Add / Edit account ─────────────────────────────────────────────────────
  const openEdit = (acc) => {
    setEditId(acc.id);
    setForm({
      name: acc.name, type: acc.type, kind: acc.kind,
      balance: String(acc.balance), currency: acc.currency,
    });
    setError(''); setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError('กรุณาใส่ชื่อบัญชี'); return; }
    const newBalance = parseFloat(form.balance) || 0;
    if (!editId && newBalance < 0) { setError('ยอดเงินต้องไม่ติดลบ'); return; }
    setSaving(true); setError('');
    try {
      if (editId) {
        const body = {
          name: form.name, type: 'asset', kind: form.kind,
          currency: form.currency,
        };
        await accountsApi.update(editId, body);
      } else {
        const body = {
          name: form.name, type: 'asset', kind: form.kind,
          balance: newBalance, currency: form.currency,
        };
        const created = await accountsApi.create(body);
        if (newBalance > 0 && created?.id) {
          await txApi.create({
            type: 'adjustment', amount: newBalance, account_id: created.id,
            transaction_date: todayStr(), note: 'ยอดเริ่มต้น',
          }).catch(() => {});
        }
      }
      await onRefresh(); setShowModal(false);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await accountsApi.delete(deleteTarget.id);
      await onRefresh();
      setDeleteTarget(null);
    } catch (err) { alert(err.message); }
    finally { setDeleting(false); }
  };

  // ── Distribute ─────────────────────────────────────────────────────────────
  const openDist = () => {
    setPoolAmount(''); setDistDate(todayStr()); setDistNote(''); setDistError('');
    setAllocations(assetAccounts.map((a) => ({ account_id: a.id, name: a.name, kind: a.kind, amount: '' })));
    setShowDist(true);
  };
  const setAlloc = (idx, val) =>
    setAllocations((prev) => prev.map((a, i) => i === idx ? { ...a, amount: val } : a));

  const pool      = parseFloat(poolAmount) || 0;
  const allocated = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const remaining = pool - allocated;
  const distValid = pool > 0 && Math.abs(remaining) < 0.01;

  const saveDist = async () => {
    if (pool <= 0)  { setDistError('กรุณาใส่ยอดเงินที่ต้องการกอง'); return; }
    if (!distValid) { setDistError(`ยอดยังไม่ครบ: เหลืออีก ฿${fmt(Math.abs(remaining))}`); return; }
    const lines = allocations.filter((a) => parseFloat(a.amount) > 0);
    if (lines.length === 0) { setDistError('กรุณาใส่ยอดอย่างน้อย 1 บัญชี'); return; }
    setDistSaving(true); setDistError('');
    try {
      await Promise.all(lines.map((a) => txApi.create({
        type: 'income', amount: parseFloat(a.amount), account_id: a.account_id,
        transaction_date: distDate, note: distNote || 'กระจายเงินเข้ากระเป๋า',
      })));
      await onRefresh(); setShowDist(false);
    } catch (err) { setDistError(err.message); }
    finally { setDistSaving(false); }
  };
  const fillRemaining = (idx) => {
    if (remaining <= 0) return;
    setAlloc(idx, String((parseFloat(allocations[idx].amount) || 0) + remaining));
  };

  // ── Account Card ───────────────────────────────────────────────────────────
  const AccountCard = ({ acc }) => {
    const k = getKind(acc.kind);
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 card-hover">
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
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-[#DCE8EE] flex items-center justify-center transition-colors">
              <Edit size={12} color="#64748b" />
            </button>
            <button onClick={() => setDeleteTarget(acc)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-100 flex items-center justify-center transition-colors">
              <Trash2 size={12} color="#94a3b8" />
            </button>
          </div>
        </div>
        <p className="text-2xl font-bold text-emerald-600">
          ฿{fmt(acc.balance)}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{acc.currency}</p>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-5">

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'ยอดเงินรวม', value: totalAssets, color: '#2C6488', bg: '#EAF3F7', prefix: '฿' },
          { label: 'บัญชีทั้งหมด', value: assetAccounts.length, color: '#10b981', bg: '#f0fdf4', suffix: ' บัญชี' },
        ].map((s, i) => (
          <div key={i} className="rounded-2xl p-4 border" style={{ background: s.bg, borderColor: s.color + '40' }}>
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>
              {s.prefix || ''}{s.prefix ? fmt(s.value) : s.value}{s.suffix || ''}
            </p>
          </div>
        ))}
      </div>

      {/* Header + action buttons */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-700">บัญชีทั้งหมด</h2>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={openPoolAdd}
            className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium">
            <Plus size={15} color="white" /> เพิ่มบัญชี
          </button>
          {assetAccounts.length > 0 && (
            <button onClick={openDist}
              className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium">
              <Share2 size={15} color="white" /> แบ่งเงินเข้าบัญชี
            </button>
          )}
        </div>
      </div>

      {assetAccounts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-3">บัญชีเงิน</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {assetAccounts.map((acc) => <AccountCard key={acc.id} acc={acc} />)}
          </div>
        </div>
      )}

      {assetAccounts.length === 0 && (
        <div className="py-20 flex flex-col items-center gap-3 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          <Briefcase size={40} color="#cbd5e1" />
          <div>
            <p className="text-sm font-semibold text-slate-600">ยังไม่มีบัญชี</p>
            <p className="text-xs text-slate-400 mt-1">สร้างบัญชีแรกเพื่อเริ่มบันทึกรายรับ รายจ่าย และโอนเงิน</p>
          </div>
          <button onClick={openPoolAdd}
            className="btn-primary text-white text-sm px-4 py-2 rounded-xl flex items-center gap-2 font-medium">
            <Plus size={15} color="white" /> สร้างบัญชีแรก
          </button>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────────── */}

      {/* Add/Edit modal */}
      {showModal && (
        <Modal title={editId ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{error}</p>}

            {/* Kind selector */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">ชนิดบัญชี</label>
              <div className="grid grid-cols-2 gap-2">
                {ASSET_KINDS.map((k) => (
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
                placeholder=""
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            {/* Balance */}
            {editId ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-xs font-medium text-slate-500 mb-1">ยอดปัจจุบัน</p>
                <p className="text-xl font-bold text-emerald-600">
                  ฿{fmt(parseFloat(form.balance) || 0)}
                </p>
                <p className="text-xs text-slate-400 mt-1">ยอดนี้มาจากรายการธุรกรรม หากยอดตั้งต้นผิดให้ลบบัญชีนี้แล้วสร้างใหม่</p>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">
                  ยอดเงินเริ่มต้น (฿)
                </label>
                <input type="number" min="0" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
            )}

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

      {/* Pool-add modal */}
      {showPoolAdd && (
        <Modal title="เพิ่มบัญชี" size="lg" onClose={() => setShowPoolAdd(false)}>
          <div className="space-y-4">
            {poolAddError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{poolAddError}</p>}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ยอดเงินทั้งหมดที่มี (฿)</label>
              <input type="number" min="0" value={poolAddAmount}
                onChange={(e) => setPoolAddAmount(e.target.value)} placeholder=""
                className="w-full border border-slate-200 rounded-2xl px-4 py-3 text-2xl bg-slate-50 text-slate-800 font-bold focus:outline-none focus:ring-2 focus:ring-[#BFD8E4] focus:border-[#2C6488]" />
            </div>
            {poolAmt > 0 && (
              <div className="rounded-2xl p-4 border border-slate-100 bg-white">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <p className="text-[11px] text-slate-400">ยอดรวม</p>
                    <p className="text-sm font-bold text-slate-700">฿{fmt(poolAmt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">จัดสรรแล้ว</p>
                    <p className="text-sm font-bold text-slate-700">฿{fmt(poolAllocated)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400">{poolOver ? 'ยอดเกิน' : 'คงเหลือ'}</p>
                    <p className={`text-sm font-bold ${poolOver ? 'text-red-500' : poolDone ? 'text-emerald-600' : 'text-[#2C6488]'}`}>
                      ฿{fmt(Math.abs(poolRemaining))}
                    </p>
                  </div>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${poolOver ? 'bg-red-400' : poolDone ? 'bg-emerald-400' : 'bg-[#2C6488]'}`}
                    style={{ width: `${poolPct}%` }} />
                </div>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-500">รายการบัญชีที่ต้องการสร้าง</label>
                <button onClick={addPoolRow}
                  className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
                  style={{ color: '#2C6488', background: '#EAF3F7' }}>
                  <Plus size={12} color="#2C6488" /> เพิ่มบัญชี
                </button>
              </div>
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {poolAddRows.map((row, idx) => {
                  const k = getKind(row.kind);
                  return (
                    <div key={row.id} className="bg-white rounded-2xl p-3 border border-slate-100 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: k.color + '18' }}>
                            <KindIcon icon={k.icon} color={k.color} size={16} />
                          </div>
                          <span className="text-xs font-semibold text-slate-500">บัญชีที่ {idx + 1}</span>
                        </div>
                        {poolAddRows.length > 1 && (
                          <button onClick={() => removePoolRow(row.id)}
                            className="w-5 h-5 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors">
                            <X size={10} color="#ef4444" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-12 sm:col-span-4">
                          <label className="text-[10px] font-medium text-slate-400 mb-0.5 block">ชนิดบัญชี</label>
                          <AssetKindDropdown
                            value={row.kind}
                            onChange={(kind) => setPoolRowField(row.id, 'kind', kind)}
                          />
                        </div>
                        <div className="col-span-12 sm:col-span-4">
                          <label className="text-[10px] font-medium text-slate-400 mb-0.5 block">ชื่อบัญชี</label>
                          <input value={row.name} onChange={(e) => setPoolRowField(row.id, 'name', e.target.value)}
                            placeholder={`เช่น ${k.label}`}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm bg-slate-50 text-slate-700" />
                        </div>
                        <div className="col-span-12 sm:col-span-4">
                          <label className="text-[10px] font-medium text-slate-400 mb-0.5 block">ยอดเงิน (฿)</label>
                          <div className="flex items-center gap-1.5">
                            <input type="number" min="0" value={row.balance}
                              onChange={(e) => setPoolRowField(row.id, 'balance', e.target.value)}
                              placeholder="0"
                              className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-right bg-slate-50 text-slate-700 font-medium" />
                            {poolAmt > 0 && poolRemaining > 0.005 && (
                              <button onClick={() => fillPoolRemaining(row.id)} title="เติมยอดที่เหลือในกอง"
                                className="px-2 h-9 rounded-lg bg-[#EAF3F7] hover:bg-[#DCE8EE] text-[11px] font-semibold text-[#2C6488] flex-shrink-0 transition-colors">
                                เติม
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
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">ยกเลิก</button>
              <button onClick={savePoolAdd} disabled={poolAddSaving || poolAmt <= 0 || poolOver}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60">
                {poolSaveLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Distribute modal */}
      {showDist && (
        <Modal title="แบ่งเงินเข้าบัญชี" onClose={() => setShowDist(false)}>
          <div className="space-y-4">
            {distError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{distError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">ยอดเงิน (฿)</label>
                <input type="number" min="0" value={poolAmount} onChange={(e) => setPoolAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700 font-bold text-lg" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">วันที่</label>
                <input type="date" value={distDate} onChange={(e) => setDistDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
              <input value={distNote} onChange={(e) => setDistNote(e.target.value)}
                placeholder="เช่น เงินเดือน เมษายน"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>
            {pool > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-500">จัดสรรแล้ว</span>
                  <span className={`font-semibold ${distValid ? 'text-emerald-600' : remaining < 0 ? 'text-red-500' : 'text-[#2C6488]'}`}>
                    ฿{fmt(allocated)} / ฿{fmt(pool)}
                    {!distValid && remaining !== 0 && (
                      <span className="ml-2 font-normal text-slate-400">
                        ({remaining > 0 ? `เหลือ +฿${fmt(remaining)}` : `เกิน -฿${fmt(Math.abs(remaining))}`})
                      </span>
                    )}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${remaining < 0 ? 'bg-red-400' : distValid ? 'bg-emerald-400' : 'bg-[#6F9DB6]'}`}
                    style={{ width: `${Math.min((allocated / pool) * 100, 100)}%` }} />
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">โยนเข้าบัญชี</label>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {allocations.map((alloc, idx) => {
                  const k = getKind(alloc.kind);
                  return (
                    <div key={alloc.account_id}
                      className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-100">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: k.color + '18' }}>
                        <KindIcon icon={k.icon} color={k.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{alloc.name}</p>
                        <p className="text-xs text-slate-400">{k.label}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-sm text-slate-400">฿</span>
                        <input type="number" min="0" value={alloc.amount}
                          onChange={(e) => setAlloc(idx, e.target.value)} placeholder="0"
                          className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right bg-white text-slate-700 font-medium" />
                        {pool > 0 && remaining > 0 && (
                          <button onClick={() => fillRemaining(idx)} title="เติมยอดที่เหลือ"
                            className="w-6 h-6 rounded-lg bg-[#EAF3F7] hover:bg-[#DCE8EE] flex items-center justify-center transition-colors flex-shrink-0">
                            <Plus size={11} color="#2C6488" />
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
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">ยกเลิก</button>
              <button onClick={saveDist} disabled={distSaving || !distValid}
                className="flex-1 btn-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
                {distSaving ? 'กำลังบันทึก...' : `โยน ฿${fmt(pool)} เข้ากระเป๋า`}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="ลบบัญชี"
        message={`ต้องการลบบัญชี "${deleteTarget?.name || ''}" ใช่ไหม? รายการธุรกรรมและรายการประจำที่เกี่ยวข้องกับบัญชีนี้จะถูกลบไปด้วย`}
        confirmText="ลบบัญชี"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
