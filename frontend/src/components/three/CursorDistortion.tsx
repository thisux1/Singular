import { type MutableRefObject } from 'react';
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

const LERP_FACTOR = 0.12;

export function CursorDistortion({ enabled, cursorStateRef }: CursorDistortionProps) {
  const mouse = useMousePosition(enabled);

  useFrame((_state, delta) => {
    const current = cursorStateRef.current;
    const next = mouse.ref.current;
    const t = 1 - Math.exp(-delta * 26);
    const blend = Math.min(1, Math.max(LERP_FACTOR, t));

    current.x += (next.normalizedX - current.x) * blend;
    current.y += (1 - next.normalizedY - current.y) * blend;
    current.active = mouse.enabled && next.active;
  });

  return null;
}
