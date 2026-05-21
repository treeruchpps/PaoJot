import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, size = 'md' }) {
  const sizeClass = {
    md: 'max-w-md',
    lg: 'max-w-2xl',
  }[size] || 'max-w-md';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-bg"
      style={{ background: 'rgba(15,23,42,0.45)' }}
    >
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${sizeClass} mx-4 modal-box`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
