import { useRef, useState, type MouseEvent, type CSSProperties } from 'react';

/**
 * Pull magnético + posição do glow (--mx/--my) compartilhado por
 * Button (<button>) e ButtonLink (<a>/<Link>). Sob reduced-motion
 * o translate é desligado; o glow continua só posicionado.
 */
export function useMagneticButton<T extends HTMLElement>(disabled = false) {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, mx: 50, my: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const onMouseMove = (e: MouseEvent<T>) => {
    if (!ref.current || disabled) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * 0.2;
    const y = (e.clientY - rect.top - rect.height / 2) * 0.2;
    const mx = ((e.clientX - rect.left) / rect.width) * 100;
    const my = ((e.clientY - rect.top) / rect.height) * 100;
    setPosition({ x, y, mx, my });
  };

  const onMouseEnter = () => setIsHovered(true);

  const onMouseLeave = () => {
    setIsHovered(false);
    setPosition({ x: 0, y: 0, mx: 50, my: 50 });
  };

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const style = {
    transform:
      !reduced && isHovered && (position.x !== 0 || position.y !== 0)
        ? `translate(${position.x}px, ${position.y}px)`
        : undefined,
    '--mx': `${position.mx}%`,
    '--my': `${position.my}%`,
  } as CSSProperties;

  return { ref, onMouseMove, onMouseEnter, onMouseLeave, style };
}
