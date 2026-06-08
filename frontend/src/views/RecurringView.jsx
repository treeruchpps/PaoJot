import { useState, useEffect, useCallback } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { ArrowUp, ArrowDown, ArrowLeftRight, Sun, CalendarDays, Calendar as CalendarIcon, Star, Clock, Edit, Trash2, Plus, RefreshCw } from 'lucide-react';
import Modal from '../components/common/Modal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { AccountSelect, CategorySelect } from '../components/common/FinanceSelects';
import Icon from '../components/common/Icon';
import { recurring as recurApi } from '../services/api';
import { fmt } from '../constants/data';
import { formatDisplayDate } from '../utils/dateFormat';
import { applySavedCategoryOrder } from '../utils/categoryOrder';
import { getTransactionAccounts } from '../utils/accountFilters';

const TYPE_LABEL = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอนเงิน' };
const TYPE_COLOR = { income: '#10b981', expense: '#ef4444', transfer: '#2C6488' };
const TYPE_BG    = { income: '#f0fdf4', expense: '#fff1f2', transfer: '#EAF3F7' };
const TYPE_ICON  = { income: 'ArrowUp', expense: 'ArrowDown', transfer: 'ArrowLeftRight' };

const FREQ_LABEL = { daily: 'ทุกวัน', weekly: 'ทุกสัปดาห์', monthly: 'ทุกเดือน', yearly: 'ทุกปี' };
const RECUR_PAGE_SIZE = 5;
const FREQ_ICON  = { daily: 'Sun', weekly: 'CalendarDays', monthly: 'Calendar', yearly: 'Star' };
const ACC_KIND_META = {
  cash:         { icon: 'DollarSign', color: '#10b981' },
  bank_account: { icon: 'Briefcase',  color: '#2C6488' },
  savings:      { icon: 'Star',       color: '#f59e0b' },
  e_wallet:     { icon: 'Smartphone', color: '#2C6488' },
  investment:   { icon: 'TrendingUp', color: '#5F9A7A' },
};

const today = new Date().toISOString().slice(0, 10);

const emptyForm = (accounts) => ({
  type:          'expense',
  amount:        '',
  name:          '',
  note:          '',
  category_id:   '',
  account_id:    accounts[0]?.id || '',
  to_account_id: accounts[1]?.id || accounts[0]?.id || '',
  frequency:     'monthly',
  next_due_date: today,
});

export default function RecurringView({ accounts, categories, onNotificationRefresh }) {
  const transactionAccounts = getTransactionAccounts(accounts || []);
  const transactionAccountIds = new Set(transactionAccounts.map((a) => a.id));
  const defaultAccountId = transactionAccounts[0]?.id || '';
  const defaultToAccountId = transactionAccounts[1]?.id || transactionAccounts[0]?.id || '';
  const { showError } = useSnackbar();
  const [list,      setList]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId,    setEditId]    = useState(null);
  const [form,      setForm]      = useState(emptyForm(transactionAccounts));
  const [saving,    setSaving]    = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [recurPage, setRecurPage] = useState(1);

  const expCats      = applySavedCategoryOrder('expense', (categories || []).filter((c) => c.type === 'expense'));
  const incCats      = applySavedCategoryOrder('income', (categories || []).filter((c) => c.type === 'income'));
  const transferCats = applySavedCategoryOrder('transfer', (categories || []).filter((c) => c.type === 'transfer'));
  const currentCats  = form.type === 'income' ? incCats
    : form.type === 'transfer' ? transferCats : expCats;

  const getAcc = (id) => accounts.find((a) => a.id === id);
  const getCat = (id) => (categories || []).find((c) => c.id === id);
  const accountMeta = (kind) => ACC_KIND_META[kind] || { icon: 'DollarSign', color: '#94a3b8' };

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await recurApi.list();
      setList(data || []);
    } catch { setList([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openAdd = () => {
    setEditId(null);
    const f = emptyForm(transactionAccounts);
    const cats = expCats;
    setForm({ ...f, category_id: cats[0]?.id || '' });
    setShowModal(true);
  };

  const openEdit = (r) => {
    const cats = r.type === 'income' ? incCats : r.type === 'transfer' ? transferCats : expCats;
    setEditId(r.id);
    setForm({
      type:          r.type,
      amount:        String(r.amount),
      name:          r.name || '',
      note:          r.note || '',
      category_id:   r.category_id || cats[0]?.id || '',
      account_id:    r.account_id || defaultAccountId,
      to_account_id: r.to_account_id || defaultToAccountId,
      frequency:     r.frequency,
      next_due_date: r.next_due_date,
    });
    setShowModal(true);
  };

  const handleTypeChange = (type) => {
    const cats = type === 'income' ? incCats : type === 'transfer' ? transferCats : expCats;
    setForm((f) => ({ ...f, type, category_id: cats[0]?.id || '' }));
  };

  const save = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { showError('กรุณาใส่จำนวนเงิน'); return; }
    if (!form.category_id) { showError('กรุณาเลือกหมวดหมู่'); return; }
    if (!form.next_due_date) { showError('กรุณาเลือกวันครบกำหนดถัดไป'); return; }
    if (!transactionAccountIds.has(form.account_id) || (form.type === 'transfer' && !transactionAccountIds.has(form.to_account_id))) {
      showError('กรุณาเลือกบัญชีที่ใช้บันทึกรายการได้');
      return;
    }
    setSaving(true); try {
      const body = {
        type:          form.type,
        amount:        parseFloat(form.amount),
        name:          form.name || null,
        note:          form.note || null,
        category_id:   form.category_id,
        account_id:    form.type === 'transfer' ? form.account_id : form.account_id,
        to_account_id: form.type === 'transfer' ? form.to_account_id : null,
        frequency:     form.frequency,
        next_due_date: form.next_due_date,
      };
      if (editId) {
        await recurApi.update(editId, body);
      } else {
        await recurApi.create(body);
      }
      await fetchList();
      onNotificationRefresh?.();
      setShowModal(false);
    } catch (err) { showError(err.message); }
    finally { setSaving(false); }
  };

  const toggle = async (r) => {
    try {
      await recurApi.update(r.id, { is_active: !r.is_active });
      await fetchList();
    } catch (err) { alert(err.message); }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await recurApi.delete(deleteTarget.id);
      await fetchList();
      setDeleteTarget(null);
    } catch (err) { alert(err.message); }
    finally { setDeleting(false); }
  };

  const active   = list.filter((r) => r.is_active);
  const inactive = list.filter((r) => !r.is_active);
  const allRecurring   = [...active, ...inactive];
  const recurTotalPages = Math.max(1, Math.ceil(allRecurring.length / RECUR_PAGE_SIZE));
  const recurSafePage   = Math.min(recurPage, recurTotalPages);
  const recurPageNums   = Array.from({ length: recurTotalPages }, (_, i) => i + 1)
    .filter((p) => recurTotalPages <= 7 || p === 1 || p === recurTotalPages || Math.abs(p - recurSafePage) <= 1);
  const pagedRecurring  = allRecurring.slice((recurSafePage - 1) * RECUR_PAGE_SIZE, recurSafePage * RECUR_PAGE_SIZE);
  const pagedActive     = pagedRecurring.filter((r) => r.is_active);
  const pagedInactive   = pagedRecurring.filter((r) => !r.is_active);

  const RecurCard = ({ r }) => {
    const acc   = getAcc(r.account_id);
    const toAcc = getAcc(r.to_account_id);
    const cat   = getCat(r.category_id);
    const overdue = r.next_due_date < today;
    const accMeta = accountMeta(acc?.kind);
    const toAccMeta = accountMeta(toAcc?.kind);

    return (
      <div className={`bg-white rounded-2xl p-4 sm:p-5 shadow-sm border transition-all ${
        r.is_active ? 'border-slate-100' : 'border-slate-100 opacity-60'
      }`}>
        {/* Top: icon · name + meta · amount */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: TYPE_BG[r.type] }}>
            {TYPE_ICON[r.type] === 'ArrowUp' && <ArrowUp size={20} color={TYPE_COLOR[r.type]} />}
            {TYPE_ICON[r.type] === 'ArrowDown' && <ArrowDown size={20} color={TYPE_COLOR[r.type]} />}
            {TYPE_ICON[r.type] === 'ArrowLeftRight' && <ArrowLeftRight size={20} color={TYPE_COLOR[r.type]} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 truncate">{r.name || '(ไม่มีชื่อ)'}</p>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400 min-w-0">
              {cat && (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <Icon name={cat.icon || 'Tag'} size={12} color={cat.color || '#94a3b8'} />
                  <span className="truncate">{cat.name}</span>
                </span>
              )}
              {cat && <span className="text-slate-300 flex-shrink-0">·</span>}
              {r.type === 'transfer' ? (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <Icon name={accMeta.icon} size={12} color={accMeta.color} />
                  <span className="truncate">{acc?.name || '?'}</span>
                  <ArrowLeftRight size={10} color="#cbd5e1" className="flex-shrink-0" />
                  <Icon name={toAccMeta.icon} size={12} color={toAccMeta.color} />
                  <span className="truncate">{toAcc?.name || '?'}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 min-w-0">
                  <Icon name={accMeta.icon} size={12} color={accMeta.color} />
                  <span className="truncate">{acc?.name || '?'}</span>
                </span>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-bold leading-tight" style={{ color: TYPE_COLOR[r.type] }}>
              {r.type === 'expense' ? '-' : '+'}฿{fmt(r.amount)}
            </p>
            <p className="text-[11px] font-medium mt-0.5" style={{ color: TYPE_COLOR[r.type] }}>{TYPE_LABEL[r.type]}</p>
          </div>
        </div>

        {/* Footer: schedule · actions */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              {FREQ_ICON[r.frequency] === 'Sun' && <Sun size={13} color="#94a3b8" />}
              {FREQ_ICON[r.frequency] === 'CalendarDays' && <CalendarDays size={13} color="#94a3b8" />}
              {FREQ_ICON[r.frequency] === 'Calendar' && <CalendarIcon size={13} color="#94a3b8" />}
              {FREQ_ICON[r.frequency] === 'Star' && <Star size={13} color="#94a3b8" />}
              {FREQ_LABEL[r.frequency]}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-medium ${
              overdue && r.is_active ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-slate-500'
            }`}>
              <Clock size={12} color={overdue && r.is_active ? '#ef4444' : '#94a3b8'} />
              {overdue && r.is_active ? 'ค้างชำระ · ' : 'ถัดไป · '}{formatDisplayDate(r.next_due_date)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => toggle(r)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                r.is_active ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
              }`}>
              {r.is_active ? 'หยุดชั่วคราว' : 'เปิดใช้งาน'}
            </button>
            <button onClick={() => openEdit(r)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-[#EAF3F7] flex items-center justify-center transition-colors"
              title="แก้ไข">
              <Edit size={12} className="text-slate-500" />
            </button>
            <button onClick={() => setDeleteTarget(r)}
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-50 flex items-center justify-center transition-colors"
              title="ลบ">
              <Trash2 size={12} className="text-slate-400 hover:text-red-500" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-700">รายการประจำ</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            รายการที่เกิดซ้ำอัตโนมัติ — กดยืนยันในแจ้งเตือนเมื่อครบกำหนด
          </p>
        </div>
        <button onClick={openAdd}
          className="text-xs px-3 py-2 rounded-xl font-medium flex flex-shrink-0 whitespace-nowrap items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F]">
          <Plus size={13} color="#ffffff" /> เพิ่มรายการ
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">กำลังโหลด...</div>
      ) : list.length === 0 ? (
        <div className="py-20 flex flex-col items-center gap-3 text-center text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
          <RefreshCw size={40} color="#cbd5e1" />
          <div>
            <p className="text-sm font-semibold text-slate-600">ยังไม่มีรายการประจำ</p>
            <p className="text-xs text-slate-400 mt-1">เพิ่มรายการแรกเพื่อให้ระบบช่วยเตือนเมื่อถึงกำหนด</p>
          </div>
          <button onClick={openAdd}
            className="text-xs px-3 py-2 rounded-xl font-medium flex flex-shrink-0 whitespace-nowrap items-center gap-1.5 border border-[#2C6488] bg-[#2C6488] text-white transition-colors hover:bg-[#25536F] hover:border-[#25536F]">
            <Plus size={13} color="#ffffff" /> สร้างรายการแรก
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active */}
          {pagedActive.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-3">
                ใช้งานอยู่ ({active.length})
              </p>
              <div className="space-y-3">
                {pagedActive.map((r) => <RecurCard key={r.id} r={r} />)}
              </div>
            </div>
          )}

          {/* Inactive */}
          {pagedInactive.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                หยุดชั่วคราว ({inactive.length})
              </p>
              <div className="space-y-3">
                {pagedInactive.map((r) => <RecurCard key={r.id} r={r} />)}
              </div>
            </div>
          )}

          {/* Pagination */}
          {allRecurring.length > RECUR_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 px-1 py-3 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                แสดง {(recurSafePage - 1) * RECUR_PAGE_SIZE + 1}–{Math.min(recurSafePage * RECUR_PAGE_SIZE, allRecurring.length)} จาก {allRecurring.length} รายการ
              </p>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setRecurPage((p) => Math.max(1, p - 1))} disabled={recurSafePage === 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                  ก่อนหน้า
                </button>
                {recurPageNums.map((p, i) => (
                  <button key={`${p}-${i}`} type="button" onClick={() => setRecurPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-semibold border transition-colors ${recurSafePage === p ? 'bg-[#2C6488] border-[#2C6488] text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-[#EAF3F7]'}`}>
                    {p}
                  </button>
                ))}
                <button type="button" onClick={() => setRecurPage((p) => Math.min(recurTotalPages, p + 1))} disabled={recurSafePage === recurTotalPages}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50">
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <Modal
          title={editId ? 'แก้ไขรายการประจำ' : 'เพิ่มรายการประจำ'}
          onClose={() => { setShowModal(false); setEditId(null); }}
          size="lg"
        >
          {/* Scrollable content */}
          <div className="space-y-3">

            {/* ประเภท */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1.5 block">ประเภท</label>
              <div className="grid grid-cols-3 gap-2">
                {['expense', 'income', 'transfer'].map((t) => (
                  <button key={t} onClick={() => handleTypeChange(t)}
                    className="py-1.5 rounded-xl border-2 text-xs font-medium transition-all flex items-center justify-center gap-1.5"
                    style={{
                      borderColor: form.type === t ? TYPE_COLOR[t] : '#e2e8f0',
                      color:       form.type === t ? TYPE_COLOR[t] : '#64748b',
                      background:  form.type === t ? TYPE_BG[t]    : '#f8fafc',
                    }}>
                    {TYPE_ICON[t] === 'ArrowUp' && <ArrowUp size={12} color={form.type === t ? TYPE_COLOR[t] : '#94a3b8'} />}
                    {TYPE_ICON[t] === 'ArrowDown' && <ArrowDown size={12} color={form.type === t ? TYPE_COLOR[t] : '#94a3b8'} />}
                    {TYPE_ICON[t] === 'ArrowLeftRight' && <ArrowLeftRight size={12} color={form.type === t ? TYPE_COLOR[t] : '#94a3b8'} />}
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* ชื่อรายการ + จำนวนเงิน */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อรายการ</label>
                <input value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="เช่น ค่าเช่า, Netflix"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
              </div>
              <div className="min-w-0">
                <label className="text-xs font-medium text-slate-500 mb-1 block">จำนวนเงิน (฿)</label>
                <input type="number" value={form.amount} placeholder="0.00" min="0"
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700 font-bold" />
              </div>
            </div>

            {/* หมวดหมู่ + บัญชี (non-transfer) */}
            {form.type !== 'transfer' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {currentCats.length > 0 && (
                  <div className="min-w-0">
                    <label className="text-xs font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
                    <CategorySelect
                      value={form.category_id}
                      onChange={(v) => setForm({ ...form, category_id: v })}
                      categories={currentCats}
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <label className="text-xs font-medium text-slate-500 mb-1 block">บัญชี</label>
                  <AccountSelect
                    value={form.account_id}
                    onChange={(v) => setForm({ ...form, account_id: v })}
                    accounts={transactionAccounts}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {currentCats.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-slate-500 mb-1 block">หมวดหมู่</label>
                    <CategorySelect
                      value={form.category_id}
                      onChange={(v) => setForm({ ...form, category_id: v })}
                      categories={currentCats}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="text-xs font-medium text-slate-500 mb-1 block">จากบัญชี</label>
                    <AccountSelect
                      value={form.account_id}
                      onChange={(v) => setForm({ ...form, account_id: v })}
                      accounts={transactionAccounts}
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="text-xs font-medium text-slate-500 mb-1 block">ไปยังบัญชี</label>
                    <AccountSelect
                      value={form.to_account_id}
                      onChange={(v) => setForm({ ...form, to_account_id: v })}
                      accounts={transactionAccounts}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ความถี่ + วันครบกำหนด */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="text-xs font-medium text-slate-500 mb-1.5 block">ความถี่</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(FREQ_LABEL).map(([val, label]) => (
                    <button key={val} onClick={() => setForm({ ...form, frequency: val })}
                      className="py-1.5 rounded-xl border-2 text-xs font-medium transition-all text-center"
                      style={{
                        borderColor: form.frequency === val ? '#2C6488' : '#e2e8f0',
                        background:  form.frequency === val ? '#EAF3F7' : '#f8fafc',
                        color:       form.frequency === val ? '#2C6488' : '#64748b',
                      }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <label className="text-xs font-medium text-slate-500 mb-1 block">ครบกำหนดถัดไป</label>
                <input type="date" value={form.next_due_date}
                  onChange={(e) => setForm({ ...form, next_due_date: e.target.value })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
              </div>
            </div>

            {/* หมายเหตุ */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">หมายเหตุ</label>
              <input value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="บันทึกเพิ่มเติม..."
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm bg-slate-50 text-slate-700" />
            </div>
          </div>

          <div className="flex gap-3 pt-3">
            <button onClick={() => { setShowModal(false); setEditId(null); }}
              className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-xl text-sm font-medium hover:bg-slate-50">
              ยกเลิก
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 btn-primary text-white py-2 rounded-xl text-sm font-medium disabled:opacity-60">
              {saving ? 'กำลังบันทึก...' : editId ? 'บันทึกการแก้ไข' : 'บันทึก'}
            </button>
          </div>
        </Modal>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="ลบรายการประจำ"
        message={`ต้องการลบรายการประจำ "${deleteTarget?.name || 'ไม่มีชื่อรายการ'}" ใช่ไหม?`}
        confirmText="ลบรายการ"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  );
}
