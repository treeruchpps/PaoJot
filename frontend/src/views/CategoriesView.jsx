import { useState, useEffect, useMemo, useRef } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import Icon from '../components/common/Icon';
import { Plus, GripVertical, X } from 'lucide-react';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { categories as categoriesApi } from '../services/api';
import { CATEGORY_ORDER_KEY, applySavedCategoryOrder } from '../utils/categoryOrder';

const ICON_OPTS  = ['UtensilsCrossed','Car','Package','ShoppingBag','Gamepad2','Home','ReceiptText','HeartPulse','Users','PawPrint','Gift','HandHeart','GraduationCap','Plane','BriefcaseBusiness','TrendingUp','CreditCard','Tv','Heart','Zap','Briefcase','Laptop','Smartphone','Shield','Monitor','Tag','Star','DollarSign','PiggyBank','Landmark','ArrowLeftRight','Wallet','Banknote'];
const COLOR_OPTS = ['#2C6488','#10b981','#f59e0b','#2C6488','#ef4444','#ec4899','#5F9A7A','#06b6d4','#f97316','#84cc16'];
const TAB_LABELS = { expense: 'รายจ่าย', income: 'รายรับ', transfer: 'โอนเงิน' };
const CAT_MAX = 30;

export default function CategoriesView({ onRefresh }) {
  const { showError } = useSnackbar();
  const [tab, setTab]             = useState('expense');
  const [catList, setCatList]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]           = useState({ name: '', icon: 'Tag', color: '#2C6488' });
  const [saving, setSaving]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Drag state
  const [orderMap,    setOrderMap]    = useState({});   // { [tab]: [id, ...] }
  const [dragIdx,     setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragNode = useRef(null);

  // Load order from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CATEGORY_ORDER_KEY) || '{}');
      setOrderMap(saved);
    } catch {}
  }, []);

  const fetchCats = async () => {
    setLoading(true);
    try { setCatList((await categoriesApi.list()) || []); }
    catch { setCatList([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchCats(); }, []);

  // Apply saved order to current tab's list
  const displayed = useMemo(() => {
    const filtered = catList.filter((c) => c.type === tab);
    const order = orderMap[tab];
    if (!order || order.length === 0) return applySavedCategoryOrder(tab, filtered);
    return applySavedCategoryOrder(tab, filtered);
  }, [catList, tab, orderMap]);

  const saveOrder = (newTab, newList) => {
    const ids = newList.map((c) => c.id);
    const updated = { ...orderMap, [newTab]: ids };
    setOrderMap(updated);
    try { localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(updated)); } catch {}
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragStart = (e, idx) => {
    dragNode.current = e.currentTarget;
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    // ทำให้ ghost image โปร่งแสงนิดหน่อย
    setTimeout(() => { if (dragNode.current) dragNode.current.style.opacity = '0.4'; }, 0);
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== dragOverIdx) setDragOverIdx(idx);
  };

  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newList = [...displayed];
    const [moved] = newList.splice(dragIdx, 1);
    newList.splice(idx, 0, moved);
    saveOrder(tab, newList);
    setDragIdx(null);
    setDragOverIdx(null);
    if (dragNode.current) dragNode.current.style.opacity = '';
    dragNode.current = null;
  };

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = '';
    dragNode.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragLeave = (e) => {
    // เฉพาะตอนออกจาก grid ทั้งหมด ไม่ใช่แค่ระหว่าง card
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIdx(null);
    }
  };

  // ── Modal ─────────────────────────────────────────────────────────────────
  const openModal = () => {
    setForm({ name: '', icon: 'Tag', color: '#2C6488' });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { showError('กรุณาใส่ชื่อหมวดหมู่'); return; }
    setSaving(true); try {
      await categoriesApi.create({ name: form.name, type: tab, icon: form.icon, color: form.color });
      await fetchCats();
      if (onRefresh) onRefresh();
      setShowModal(false);
      setForm({ name: '', icon: 'Tag', color: '#2C6488' });
    } catch (err) { showError(err.message); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await categoriesApi.delete(deleteTarget.id);
      await fetchCats();
      if (onRefresh) onRefresh();
      setDeleteTarget(null);
    }
    catch (err) { alert(err.message); }
    finally { setDeleting(false); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full sm:w-auto bg-slate-100 rounded-xl p-1 gap-1">
          {['expense', 'income', 'transfer'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 sm:flex-none whitespace-nowrap text-center px-3 sm:px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <button onClick={openModal} disabled={displayed.length >= CAT_MAX}
          className="text-xs px-3 py-2 rounded-xl font-medium flex w-full sm:w-auto justify-center whitespace-nowrap items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F] disabled:opacity-50 disabled:cursor-not-allowed">
          <Plus size={13} color="#ffffff" /> เพิ่มหมวดหมู่
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลด...</div>
      ) : (
        <>
          {displayed.length >= CAT_MAX && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700 font-medium mb-2">
              ถึงจำนวนสูงสุด {CAT_MAX} หมวดหมู่แล้ว ไม่สามารถเพิ่มได้อีก
            </div>
          )}
          <div
            className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3"
            onDragLeave={handleDragLeave}
          >
          {displayed.map((c, idx) => {
            const cardColor  = c.color || '#2C6488';
            const isDragging = dragIdx === idx;
            const isOver     = dragOverIdx === idx && dragIdx !== idx;

            return (
              <div
                key={c.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e)  => handleDragOver(e, idx)}
                onDrop={(e)      => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={`bg-white rounded-2xl p-3 sm:p-4 shadow-sm border flex flex-col items-center gap-2.5 relative group select-none transition-all
                  ${isDragging ? 'opacity-40 scale-95' : 'opacity-100'}
                  ${isOver
                    ? 'border-[#6F9DB6] shadow-md scale-105 bg-[#EAF3F7]'
                    : 'border-slate-100 hover:border-[#BFD8E4] card-hover'}
                `}
                style={{ cursor: 'grab' }}
              >
                {/* Drag handle — แสดงตอน hover */}
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-40 transition-opacity">
                  <GripVertical size={12} color="#94a3b8" />
                </div>

                <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ background: cardColor + '22' }}>
                  <Icon name={c.icon || 'Tag'} size={24} color={cardColor} />
                </div>
                <p className="text-xs font-medium text-slate-700 text-center leading-snug">{c.name}</p>

                {/* ปุ่มลบ — เฉพาะ user-created */}
                {c.user_id && (
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    style={{ cursor: 'default' }}>
                    <X size={10} color="#ef4444" />
                  </button>
                )}
              </div>
            );
          })}

          {/* ปุ่มเพิ่มใหม่ */}
          <div onClick={openModal}
            className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col items-center gap-2.5 cursor-pointer hover:border-[#BFD8E4] hover:bg-[#EAF3F7] transition-all">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-slate-100">
              <Plus size={22} color="#94a3b8" />
            </div>
            <p className="text-xs text-slate-400">เพิ่มใหม่</p>
          </div>
          </div>
        </>
      )}

      {showModal && (
        <Modal title="เพิ่มหมวดหมู่ใหม่" onClose={() => setShowModal(false)}>
          <div className="space-y-4">

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อหมวดหมู่</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น สัตว์เลี้ยง, เกม"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">ไอคอน</label>
              <div className="flex gap-2 flex-wrap">
                {ICON_OPTS.map((ico) => (
                  <button key={ico} onClick={() => setForm({ ...form, icon: ico })}
                    className="w-9 h-9 rounded-xl flex items-center justify-center border-2 transition-all"
                    style={{
                      background:  form.icon === ico ? form.color + '22' : '#f8fafc',
                      borderColor: form.icon === ico ? form.color : '#e2e8f0',
                    }}>
                    <Icon name={ico} size={16} color={form.icon === ico ? form.color : '#94a3b8'} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-2 block">สี</label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_OPTS.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, color: c })}
                    className="w-7 h-7 rounded-full border-2 transition-all"
                    style={{ background: c, borderColor: form.color === c ? '#1e293b' : 'transparent' }} />
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium">ยกเลิก</button>
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
        title="ลบหมวดหมู่"
        message={`ต้องการลบหมวดหมู่ "${deleteTarget?.name || ''}" ใช่ไหม?`}
        confirmText="ลบหมวดหมู่"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
