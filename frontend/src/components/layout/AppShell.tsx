import { Outlet } from 'react-router';
import { GrainOverlay } from '../effects/GrainOverlay';
import { ToastContainer } from '../ui/Toast';
import { useMousePosition } from '../../hooks/useMousePosition';
import { SingularityCanvas } from '../three/SingularityCanvas';
import { Navbar } from './Navbar';
import './AppShell.css';

import { useEffect, useState } from 'react';

function DomCursor() {
  const mouse = useMousePosition(true);
  const [trail, setTrail] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!mouse.active) return;
    let animationFrameId: number;
    const updateTrail = () => {
      setTrail((prev) => {
        const dx = mouse.x - prev.x;
        const dy = mouse.y - prev.y;
        return {
          x: prev.x + dx * 0.15,
          y: prev.y + dy * 0.15,
        };
      });
      animationFrameId = requestAnimationFrame(updateTrail);
    };
    updateTrail();
    return () => cancelAnimationFrame(animationFrameId);
  }, [mouse.x, mouse.y, mouse.active]);

  if (!mouse.enabled) {
    return null;
  }

  const fallbackX = typeof window === 'undefined' ? 0 : window.innerWidth * 0.5;
  const fallbackY = typeof window === 'undefined' ? 0 : window.innerHeight * 0.5;
  const cursorX = mouse.active ? mouse.x : fallbackX;
  const cursorY = mouse.active ? mouse.y : fallbackY;
  const trailX = mouse.active ? trail.x : fallbackX;
  const trailY = mouse.active ? trail.y : fallbackY;

  return (
    <>
      <div
        className={`app-shell__cursor ${mouse.active ? 'is-active' : ''}`}
        style={{ transform: `translate3d(${cursorX}px, ${cursorY}px, 0) translate3d(-50%, -50%, 0)` }}
        aria-hidden="true"
      />
      <div
        className={`app-shell__cursor-trail ${mouse.active ? 'is-active' : ''}`}
        style={{ transform: `translate3d(${trailX}px, ${trailY}px, 0) translate3d(-50%, -50%, 0)` }}
        aria-hidden="true"
      />
    </>
  );
}

export function AppShell() {
  return (
    <div className="app-shell">
      <SingularityCanvas />
      <GrainOverlay />
      <div className="app-shell__content">
        <Navbar />
        <main className="app-shell__main">
          <Outlet />
        </main>
      </div>
      <DomCursor />
      <ToastContainer />
    </div>
  );
}
