import type { ReactNode } from 'react';
import './Badge.css';

type BadgeVariant = 'default' | 'correct' | 'incorrect' | 'warning' | 'info' | 'processing';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge--${variant} ${className}`}>
      {children}
    </span>
  );
}
