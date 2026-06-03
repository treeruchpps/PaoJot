import { AlertTriangle, CheckCircle2, Loader2, Trash2, XCircle } from 'lucide-react';
import Modal from './Modal';

export default function ConfirmDialog({
  open,
  title = 'ยืนยันการทำรายการ',
  message,
  confirmText = 'ยืนยัน',
  cancelText = 'ปิด',
  tone = 'danger',
  note,
  loading = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;

  const isDanger = tone === 'danger';
  const isPrimary = tone === 'primary';
  const Icon = isPrimary ? CheckCircle2 : isDanger ? Trash2 : AlertTriangle;
  const iconColor = isPrimary ? '#2C6488' : isDanger ? '#ef4444' : '#f59e0b';
  const iconBg = isPrimary ? '#EAF3F7' : isDanger ? '#fff1f2' : '#fffbeb';
  const buttonClass = isPrimary
    ? 'bg-[#2C6488] hover:bg-[#25536F]'
    : isDanger
      ? 'bg-red-500 hover:bg-red-600'
      : 'bg-amber-500 hover:bg-amber-600';
  const helperText = note ?? (isPrimary
    ? 'ตรวจสอบข้อมูลให้ถูกต้องก่อนยืนยันการบันทึก'
    : 'การทำรายการนี้อาจไม่สามารถย้อนกลับได้');

  return (
    <Modal title={title} onClose={loading ? () => {} : onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: iconBg }}
          >
            <Icon size={21} color={iconColor} />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
            {helperText && <p className="text-xs text-slate-400 mt-1">{helperText}</p>}
          </div>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <XCircle size={15} />
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 ${buttonClass}`}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            {loading ? 'กำลังดำเนินการ...' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
