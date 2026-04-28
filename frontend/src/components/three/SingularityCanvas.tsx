import { Suspense, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { BlackholeBackground } from './BlackholeBackground';
import { CursorDistortion, type CursorDistortionState } from './CursorDistortion';
import { useGpuTier } from '../../hooks/useGpuTier';
import './SingularityCanvas.css';

/**
 * Full-screen R3F canvas positioned behind all DOM content.
 *
 * The BlackholeBackground component handles all rendering internally
 * via a multi-pass pipeline (space → distortion → final composition).
 * The Canvas is just the WebGL context provider.
 */
export function SingularityCanvas() {
  const tier = useGpuTier();
  const isTouchLike = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches
    );
  }, []);
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  const cursorStateRef = useRef<CursorDistortionState>({
    x: 0.5,
    y: 0.5,
    active: false,
  });

  if (tier === 'low' || prefersReducedMotion || isTouchLike) {
    return <div className="singularity-fallback" aria-hidden="true" />;
  }

  return (
    <div className="singularity-canvas" aria-hidden="true">
      <Canvas
        gl={{ antialias: tier === 'high', alpha: false, powerPreference: 'high-performance', stencil: false, depth: true }}
        dpr={[1, tier === 'high' ? 1.5 : 1]}
        camera={{ position: [0, 0, 1], fov: 45, near: 0.1, far: 10 }}
        frameloop="always"
      >
        <Suspense fallback={null}>
          <BlackholeBackground tier={tier} reducedMotion={prefersReducedMotion} cursorStateRef={cursorStateRef} />
          <CursorDistortion enabled={!prefersReducedMotion} cursorStateRef={cursorStateRef} />
        </Suspense>
      </Canvas>
    </div>
  );
}
