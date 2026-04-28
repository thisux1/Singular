import './GrainOverlay.css';

/**
 * Film grain / cosmic dust overlay.
 * Uses a CSS-animated noise texture for the "inhabited void" effect.
 * Always rendered — low cost (single CSS animation on a fixed div).
 */
export function GrainOverlay() {
  return (
    <div className="grain-overlay" aria-hidden="true" />
  );
}
