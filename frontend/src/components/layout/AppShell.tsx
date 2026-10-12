import { Outlet, useLocation } from 'react-router';
import { AnimatePresence } from 'framer-motion';
import { PageTransition } from '../effects/PageTransition';
import { GrainOverlay } from '../effects/GrainOverlay';
import { ToastContainer } from '../ui/Toast';
import { isTouchLikeEnvironment } from '../../hooks/useMousePosition';
import { SingularityCanvas } from '../three/SingularityCanvas';
import { Navbar } from './Navbar';
import { FuiOverlay } from '../fui/FuiOverlay';
import './AppShell.css';

import { useEffect, useRef, useState } from 'react';

function DomCursor() {
  const [enabled, setEnabled] = useState(() => !isTouchLikeEnvironment());
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const trailPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const hoverNoneQuery = window.matchMedia('(hover: none)');
    const sync = () => setEnabled(!isTouchLikeEnvironment());
    coarseQuery.addEventListener('change', sync);
    hoverNoneQuery.addEventListener('change', sync);
    return () => {
      coarseQuery.removeEventListener('change', sync);
      hoverNoneQuery.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const mouse = mouseRef.current;
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      if (!mouse.active) {
        mouse.active = true;
        trailPosRef.current.x = mouse.x;
        trailPosRef.current.y = mouse.y;
        cursorRef.current?.classList.add('is-active');
        trailRef.current?.classList.add('is-active');
      }
    };
    const onPointerLeave = () => {
      mouseRef.current.active = false;
      cursorRef.current?.classList.remove('is-active');
      trailRef.current?.classList.remove('is-active');
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('blur', onPointerLeave);

    let animationFrameId = 0;
    const updateTrail = () => {
      const { x, y } = mouseRef.current;
      const trail = trailPosRef.current;
      trail.x += (x - trail.x) * 0.15;
      trail.y += (y - trail.y) * 0.15;
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate3d(-50%, -50%, 0)`;
      }
      if (trailRef.current) {
        trailRef.current.style.transform = `translate3d(${trail.x}px, ${trail.y}px, 0) translate3d(-50%, -50%, 0)`;
      }
      animationFrameId = requestAnimationFrame(updateTrail);
    };
    updateTrail();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onPointerLeave);
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <div ref={cursorRef} className="app-shell__cursor" aria-hidden="true" />
      <div ref={trailRef} className="app-shell__cursor-trail" aria-hidden="true" />
    </>
  );
}

export function AppShell() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <SingularityCanvas />
      <FuiOverlay />
      <GrainOverlay />
      <div className="app-shell__content">
        <Navbar />
        <main className="app-shell__main">
          <AnimatePresence mode="wait">
            <PageTransition locationKey={location.pathname}>
              <Outlet />
            </PageTransition>
          </AnimatePresence>
        </main>
      </div>
      <DomCursor />
      <ToastContainer />
    </div>
  );
}
