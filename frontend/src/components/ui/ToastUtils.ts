import { type ReactNode } from 'react';

export type ToastVariant = 'info' | 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

export type AddToastFn = (message: string, variant?: ToastVariant) => void;

let addToastGlobal: AddToastFn | null = null;

export const setAddToastGlobal = (fn: AddToastFn | null) => {
  addToastGlobal = fn;
};

/** Global toast trigger — call from anywhere */
export function toast(message: string, variant: ToastVariant = 'info') {
  addToastGlobal?.(message, variant);
}

export function variantIcon(variant: ToastVariant): ReactNode {
  switch (variant) {
    case 'success': return '✓';
    case 'error': return '✕';
    case 'warning': return '⚠';
    case 'info': return 'ℹ';
  }
}
