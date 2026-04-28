import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type CSSProperties } from 'react';
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, mx: 50, my: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (!buttonRef.current || disabled || loading) return;
    const rect = buttonRef.current.getBoundingClientRect();
    
    // Magnetic Pull (Move the button slightly towards the cursor)
    const x = (e.clientX - rect.left - rect.width / 2) * 0.2; 
    const y = (e.clientY - rect.top - rect.height / 2) * 0.2;
    
    // Glow position (Percentage relative to button size)
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;

    setPosition({ x, y, mx, my });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setPosition({ x: 0, y: 0, mx: 50, my: 50 });
  };

  return (
    <button
      ref={buttonRef}
      className={`btn btn--${variant} btn--${size} ${className}`}
      disabled={disabled || loading}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: isHovered && (position.x !== 0 || position.y !== 0) ? `translate(${position.x}px, ${position.y}px)` : undefined,
        '--mx': `${position.mx}%`,
        '--my': `${position.my}%`,
      } as CSSProperties}
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
