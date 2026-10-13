import { useEffect, useState } from 'react';
import { useGpuTier } from '../../hooks/useGpuTier';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { setStaticBackground, useStaticBackground } from '../../hooks/useStaticBackground';
import { setPerfLite, usePerfLite } from '../../hooks/usePerfLite';
import { FuiWaveform } from './FuiWaveform';
import './FuiOverlay.css';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

// Indicador passivo — label + dot, sem affordance de clique.
// Escondido de leitores de tela: o texto é jargão decorativo sem valor de status real.
function FuiStatusIndicator({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`fui-toggle ${active ? 'fui-toggle--active' : ''}`} aria-hidden="true">
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
    <div className="fui-particles-layer" aria-hidden="true">
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
  const bgStatic = useStaticBackground();
  const perfLite = usePerfLite();

  // Overlays decorativos animados só rodam em GPU saudável,
  // sem preferência de movimento reduzido e com ponteiro preciso.
  const motionEnabled = !prefersReducedMotion && gpuTier !== 'low' && !coarsePointer && !perfLite;

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

  // O overlay não pode ter aria-hidden global: o MANUAL_OVRD é um botão
  // real e focusável. Cada ramo decorativo é escondido individualmente.
  return (
    <div className={`fui-overlay${motionEnabled ? '' : ' fui-overlay--reduced'}`}>
      {/* Top Left Status */}
      <div className="fui-hud-element fui-hud--top-left" aria-hidden="true">
        <span className="fui-text-highlight">SYS.OP.MODE // NOMINAL</span>
      </div>

      {/* Top Right Status & Radar */}
      <div className="fui-hud-element fui-hud--top-right" aria-hidden="true">
        <span className="fui-text-dim">{timeStr}</span>
        <FuiRadar />
      </div>

      {/* Background Particles — apenas com motion habilitado */}
      {motionEnabled && <FuiDataParticles />}

      {/* Bottom Left: indicadores passivos + override real do background */}
      <div className="fui-hud-element fui-hud--bottom-left">
        <div className="fui-toggles">
          <FuiStatusIndicator label="DATA_STREAM" active />
          <FuiStatusIndicator label="NEURAL_LINK" active />
          <button
            type="button"
            className={`fui-toggle fui-toggle--btn${bgStatic ? ' fui-toggle--active' : ''}`}
            aria-pressed={bgStatic}
            aria-label={
              bgStatic
                ? 'Fundo animado desligado — pressione para reativar'
                : 'Desligar fundo animado (modo estático)'
            }
            title="MANUAL_OVRD — desliga o fundo animado (menos GPU)"
            onClick={() => setStaticBackground(!bgStatic)}
          >
            <span className="fui-toggle__light" aria-hidden="true" />
            <span className="fui-toggle__label">MANUAL_OVRD</span>
          </button>
          <button
            type="button"
            className={`fui-toggle fui-toggle--btn${perfLite ? ' fui-toggle--active' : ''}`}
            aria-pressed={perfLite}
            aria-label={
              perfLite
                ? 'Modo leve ligado — pressione para voltar aos efeitos completos'
                : 'Ligar modo leve (só efeitos compostáveis)'
            }
            title="FX.LITE — só transform/opacity: desliga blur, glow e o raymarcher"
            onClick={() => setPerfLite(!perfLite)}
          >
            <span className="fui-toggle__light" aria-hidden="true" />
            <span className="fui-toggle__label">FX.LITE</span>
          </button>
        </div>
      </div>

      {/* Bottom Right: Spectral Waveform */}
      <div className="fui-hud-element fui-hud--bottom-right" aria-hidden="true">
        <div className="fui-spectral-container">
          <span className="fui-text-dim">FLUX_CAPACITY</span>
          <FuiWaveform animated={motionEnabled} />
        </div>
      </div>
    </div>
  );
}
