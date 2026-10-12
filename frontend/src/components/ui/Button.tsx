import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useMagneticButton } from './useMagneticButton';
import './Button.css';

type ButtonVariant = 'primary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const magnetic = useMagneticButton<HTMLButtonElement>(disabled || loading);

  return (
    <button
      className={`btn btn--${variant} btn--${size} ${className}`}
      disabled={disabled || loading}
      {...magnetic}
      {...props}
    >
      <div className="btn__magnetic-glow" />
      {loading ? (
        <>
          <span className="btn__spinner" aria-hidden="true" />
          <span className="sr-only">Carregando...</span>
        </>
      ) : null}
      <span className={`btn__content ${loading ? 'btn__content--loading' : ''}`}>{children}</span>
    </button>
  );
}
