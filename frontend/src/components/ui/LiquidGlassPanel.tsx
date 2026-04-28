import type { HTMLAttributes } from 'react';
import './LiquidGlassPanel.css';

type LiquidGlassPanelProps = HTMLAttributes<HTMLDivElement>;

export function LiquidGlassPanel({ className = '', style, ...props }: LiquidGlassPanelProps) {
  return <div className={`liquid-glass ${className}`.trim()} style={style} {...props} />;
}
