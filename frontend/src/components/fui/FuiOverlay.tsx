import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useGpuTier } from '../../hooks/useGpuTier';
import { FuiWaveform } from './FuiWaveform';
import './FuiOverlay.css';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function FuiStatusToggle({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`fui-toggle ${active ? 'fui-toggle--active' : ''}`}>
      <span className="fui-toggle__light" />
      <span className="fui-toggle__label">{label}</span>
    </div>
  );
}

function FuiRadar() {
  return (
    <div className="fui-radar">
      <div className="fui-radar__ring-1" />
      <div className="fui-radar__ring-2" />
      <div className="fui-radar__ring-3">
        <div className="fui-radar-sweep" />
      </div>
      <div className="fui-radar__core" />
      <div className="fui-radar__crosshair-h" />
      <div className="fui-radar__crosshair-v" />
    </div>
  );
}

// Distribute mostly near the edges (left 15% and right 15%)
const PARTICLES = Array.from({ length: 30 }, () => {
  const isLeft = Math.random() > 0.5;
  return {
    leftPos: isLeft ? Math.random() * 15 : 85 + Math.random() * 15,
    size: Math.random() > 0.8 ? 3 : 1,
    delay: Math.random() * 10,
    duration: 5 + Math.random() * 10,
  };
});

function FuiDataParticles() {
  return (
    <div className="fui-particles-layer">
      {PARTICLES.map((particle, i) => (
        <div
          key={i}
          className={`fui-particle ${particle.size > 1 ? 'fui-particle--large' : ''}`}
          style={{
            left: `${particle.leftPos}%`,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`
          }}
        />
      ))}
    </div>
  );
}

export function FuiOverlay() {
  const [timeStr, setTimeStr] = useState('');
  const gpuTier = useGpuTier();
  const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const coarsePointer = useMediaQuery(COARSE_POINTER_QUERY);

  // Overlays decorativos animados só rodam em GPU saudável,
  // sem preferência de movimento reduzido e com ponteiro preciso.
  const motionEnabled = !prefersReducedMotion && gpuTier !== 'low' && !coarsePointer;

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(`${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}:${now.getUTCSeconds().toString().padStart(2, '0')} UTC`);
    };
    update();
    // Sem motion: o relógio fica estático (sem re-render a cada segundo).
    if (!motionEnabled) return;
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [motionEnabled]);

  return (
    <div
      className={`fui-overlay${motionEnabled ? '' : ' fui-overlay--reduced'}`}
      aria-hidden="true"
    >
      {/* Decorative Grid Lines */}
      <div className="fui-grid-lines" />

      {/* Top Left Status */}
      <div className="fui-hud-element fui-hud--top-left">
        <span className="fui-text-highlight">SYS.OP.MODE // NOMINAL</span>
      </div>

      {/* Top Right Status & Radar */}
      <div className="fui-hud-element fui-hud--top-right">
        <span className="fui-text-dim">{timeStr}</span>
        <FuiRadar />
      </div>

      {/* Background Particles — apenas com motion habilitado */}
      {motionEnabled && <FuiDataParticles />}

      {/* Bottom Left: Toggles & Status */}
      <div className="fui-hud-element fui-hud--bottom-left">
        <div className="fui-toggles">
          <FuiStatusToggle label="DATA_STREAM" active />
          <FuiStatusToggle label="NEURAL_LINK" active />
          <FuiStatusToggle label="MANUAL_OVRD" active={false} />
        </div>
      </div>

      {/* Bottom Right: Spectral Waveform */}
      <div className="fui-hud-element fui-hud--bottom-right">
        <div className="fui-spectral-container">
          <span className="fui-text-dim" style={{ fontSize: '10px', letterSpacing: '2px' }}>FLUX_CAPACITY</span>
          <FuiWaveform animated={motionEnabled} />
        </div>
      </div>
    </div>
  );
}
