import { useEffect, useMemo, useState } from 'react';

export type MousePosition = {
  x: number;
  y: number;
  normalizedX: number;
  normalizedY: number;
  active: boolean;
  enabled: boolean;
};

function isTouchLikeEnvironment(): boolean {
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

export function useMousePosition(enabled = true): MousePosition {
  const [isTouchLike, setIsTouchLike] = useState(() => isTouchLikeEnvironment());
  const [position, setPosition] = useState(() => ({
    x: 0,
    y: 0,
    normalizedX: 0.5,
    normalizedY: 0.5,
    active: false,
  }));

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
      const normalizedX = event.clientX / width;
      const normalizedY = event.clientY / height;

      setPosition({
        x: event.clientX,
        y: event.clientY,
        normalizedX,
        normalizedY,
        active: true,
      });
    };

    const onPointerLeave = () => {
      setPosition((previous) => ({ ...previous, active: false }));
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('blur', onPointerLeave);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
    };
  }, [shouldTrack]);

  return useMemo(
    () => ({
      ...position,
      active: shouldTrack ? position.active : false,
      enabled: shouldTrack,
    }),
    [position, shouldTrack]
  );
}
