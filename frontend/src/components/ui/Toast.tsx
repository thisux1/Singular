import { useEffect, useState, useCallback } from 'react';
import { setAddToastGlobal, type ToastItem, type ToastVariant } from './ToastUtils';
import './Toast.css';

function variantTag(variant: ToastVariant): string {
  switch (variant) {
    case 'success': return '[  OK  ]';
    case 'error':   return '[ FAIL ]';
    case 'warning': return '[ WARN ]';
    case 'info':    return '[ INFO ]';
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<(ToastItem & { timestamp: string })[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = crypto.randomUUID();
    const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    setToasts(prev => [...prev, { id, message, variant, timestamp }]);

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
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

function ToastMessage({ toast: t, onDismiss }: { toast: ToastItem & { timestamp: string }; onDismiss: () => void }) {
  return (
    <div className={`toast toast--${t.variant}`} role="alert">
      <span className="toast__time">{t.timestamp}</span>
      <span className="toast__tag">{variantTag(t.variant)}</span>
      <span className="toast__message">{t.message}</span>
      <button className="toast__dismiss" onClick={onDismiss} aria-label="Fechar">
        ✕
      </button>
    </div>
  );
}
