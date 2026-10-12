import { useEffect, useRef, useState, type MutableRefObject } from 'react';

export type MousePosition = {
  x: number;
  y: number;
  normalizedX: number;
  normalizedY: number;
  active: boolean;
};

export type MousePositionRef = {
  /** Posição viva — mutada direto no pointermove, sem re-render. */
  ref: MutableRefObject<MousePosition>;
  /** false em ambientes touch-like ou quando `enabled=false`. */
  enabled: boolean;
};

export function isTouchLikeEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(hover: none)').matches
  );
}

/**
 * Pointer tracking sem custo de render: a posição vai para um ref
 * (zero setState por frame); estado React só muda quando o ambiente
 * coarse/hover muda — evento raro.
 */
export function useMousePosition(enabled = true): MousePositionRef {
  const [isTouchLike, setIsTouchLike] = useState(() => isTouchLikeEnvironment());
  const positionRef = useRef<MousePosition>({
    x: 0,
    y: 0,
    normalizedX: 0.5,
    normalizedY: 0.5,
    active: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const hoverNoneQuery = window.matchMedia('(hover: none)');

    const syncTouchLike = () => {
      setIsTouchLike(
        'ontouchstart' in window || navigator.maxTouchPoints > 0 || coarseQuery.matches || hoverNoneQuery.matches
      );
    };

    const onPointerChange = () => syncTouchLike();
    coarseQuery.addEventListener('change', onPointerChange);
    hoverNoneQuery.addEventListener('change', onPointerChange);
    syncTouchLike();

    return () => {
      coarseQuery.removeEventListener('change', onPointerChange);
      hoverNoneQuery.removeEventListener('change', onPointerChange);
    };
  }, []);

  const shouldTrack = enabled && !isTouchLike;

  useEffect(() => {
    if (!shouldTrack || typeof window === 'undefined') {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') {
        return;
      }

      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const pos = positionRef.current;
      pos.x = event.clientX;
      pos.y = event.clientY;
      pos.normalizedX = event.clientX / width;
      pos.normalizedY = event.clientY / height;
      pos.active = true;
    };

    const position = positionRef.current;

    const onPointerLeave = () => {
      position.active = false;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('blur', onPointerLeave);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
      position.active = false;
    };
  }, [shouldTrack]);

  return { ref: positionRef, enabled: shouldTrack };
}
