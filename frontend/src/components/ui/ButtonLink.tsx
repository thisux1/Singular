import { type AnchorHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMagneticButton } from './useMagneticButton';
import './Button.css';

type ButtonVariant = 'primary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Rota interna (react-router Link). */
  to?: string;
  /** Link externo ou âncora — renderiza <a>. */
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/** Mesma máquina .btn (camadas, pull magnético, glow) para CTAs que são links. */
export function ButtonLink({
  to,
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonLinkProps) {
  const magnetic = useMagneticButton<HTMLAnchorElement>();
  const cls = `btn btn--${variant} btn--${size} ${className}`;
  const inner = (
    <>
      <div className="btn__magnetic-glow" />
      <span className="btn__content">{children}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={cls} {...magnetic} {...rest}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} {...magnetic} {...rest}>
      {inner}
    </a>
  );
}
