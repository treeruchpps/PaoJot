import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, AlertCircle, CheckCircle2, Info } from 'lucide-react';

const SnackbarContext = createContext(null);

export function SnackbarProvider({ children }) {
  const [snacks, setSnacks] = useState([]);
  const idRef = useRef(0);

  const show = useCallback((message, type = 'error', duration = 3500) => {
    if (message == null || !String(message).trim()) return;
    const id = ++idRef.current;
    setSnacks((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setSnacks((prev) => prev.filter((s) => s.id !== id));
    }, duration);
  }, []);

  const dismiss = useCallback((id) => {
    setSnacks((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const showError   = useCallback((msg) => show(msg, 'error'),   [show]);
  const showSuccess = useCallback((msg) => show(msg, 'success'), [show]);
  const showInfo    = useCallback((msg) => show(msg, 'info'),    [show]);

  return (
    <SnackbarContext.Provider value={{ showError, showSuccess, showInfo }}>
      {children}
      <SnackbarStack snacks={snacks} onDismiss={dismiss} />
    </SnackbarContext.Provider>
  );
}

export function useSnackbar() {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error('useSnackbar must be used inside SnackbarProvider');
  return ctx;
}

const TYPE_STYLE = {
  error:   { bg: 'bg-red-600',     icon: AlertCircle,    label: 'text-white' },
  success: { bg: 'bg-emerald-600', icon: CheckCircle2,   label: 'text-white' },
  info:    { bg: 'bg-[#2C6488]',   icon: Info,           label: 'text-white' },
};

function SnackbarStack({ snacks, onDismiss }) {
  if (!snacks.length) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none">
      {snacks.map((s) => {
        const { bg, icon: Icon } = TYPE_STYLE[s.type] || TYPE_STYLE.error;
        return (
          <div
            key={s.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl ${bg} text-white text-sm font-medium max-w-sm w-max animate-snack`}
          >
            <Icon size={16} className="flex-shrink-0" />
            <span className="flex-1">{s.message}</span>
            <button onClick={() => onDismiss(s.id)} className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity ml-1">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
