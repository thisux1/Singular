import { useEffect, useState } from 'react';
import { FuiWaveform } from './FuiWaveform';
import './FuiOverlay.css';



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

function FuiDataParticles() {
  return (
    <div className="fui-particles-layer">
      {Array.from({ length: 30 }).map((_, i) => {
        // Distribute mostly near the edges (left 15% and right 15%)
        const isLeft = Math.random() > 0.5;
        const leftPos = isLeft ? Math.random() * 15 : 85 + Math.random() * 15;
        const size = Math.random() > 0.8 ? 3 : 1;
        return (
          <div 
            key={i} 
            className={`fui-particle ${size > 1 ? 'fui-particle--large' : ''}`} 
            style={{
              left: `${leftPos}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${5 + Math.random() * 10}s`
            }} 
          />
        );
      })}
    </div>
  );
}

export function FuiOverlay() {
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(`${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}:${now.getUTCSeconds().toString().padStart(2, '0')} UTC`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fui-overlay" aria-hidden="true">
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

      {/* Background Particles */}
      <FuiDataParticles />

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
          <FuiWaveform />
        </div>
      </div>
    </div>
  );
}
