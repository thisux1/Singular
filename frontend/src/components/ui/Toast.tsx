import { useEffect, useState, useCallback } from 'react';
import { setAddToastGlobal, variantIcon, type ToastItem, type ToastVariant } from './ToastUtils';
import './Toast.css';

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, variant }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    setAddToastGlobal(addToast);
    return () => { setAddToastGlobal(null); };
  }, [addToast]);

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(t => (
        <ToastMessage key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastMessage({ toast: t, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${t.variant}`} role="alert">
      <span className="toast__icon">{variantIcon(t.variant)}</span>
      <span className="toast__message">{t.message}</span>
      <button className="toast__dismiss" onClick={onDismiss} aria-label="Fechar">
        ✕
      </button>
    </div>
  );
}
