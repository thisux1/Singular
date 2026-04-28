import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useMousePosition } from '../../hooks/useMousePosition';

export type CursorDistortionState = {
  x: number;
  y: number;
  active: boolean;
};

type CursorDistortionProps = {
  enabled: boolean;
  cursorStateRef: MutableRefObject<CursorDistortionState>;
};

const LERP_FACTOR = 1;

export function CursorDistortion({ enabled, cursorStateRef }: CursorDistortionProps) {
  const mouse = useMousePosition(enabled);
  const targetRef = useRef({ x: 0.5, y: 0.5, active: false });

  useEffect(() => {
    if (!enabled || !mouse.enabled) {
      targetRef.current = { x: 0.5, y: 0.5, active: false };
      return;
    }

    targetRef.current = {
      x: mouse.normalizedX,
      y: 1 - mouse.normalizedY,
      active: mouse.active,
    };
  }, [enabled, mouse.enabled, mouse.normalizedX, mouse.normalizedY, mouse.active]);

  useFrame((_state, delta) => {
    const next = targetRef.current;
    const current = cursorStateRef.current;
    const t = 1 - Math.exp(-delta * 26);
    const blend = Math.min(1, Math.max(LERP_FACTOR, t));

    current.x += (next.x - current.x) * blend;
    current.y += (next.y - current.y) * blend;
    current.active = next.active;
  });

  return null;
}
