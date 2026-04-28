import type { ReactNode } from 'react';
import './TerminalFrame.css';

type TerminalTone = 'default' | 'error';

interface TerminalFrameProps {
  className?: string;
  tone?: TerminalTone;
  badge?: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function TerminalFrame({ className = '', tone = 'default', badge, header, children, footer }: TerminalFrameProps) {
  return (
    <div className={`terminal-frame terminal-frame--${tone} ${className}`.trim()}>
      <div className="terminal-frame__glow" />
      {badge ? <div className="terminal-frame__badge">{badge}</div> : null}
      {header ? <div className="terminal-frame__header">{header}</div> : null}
      <div className="terminal-frame__body">{children}</div>
      {footer ? <div className="terminal-frame__footer">{footer}</div> : null}
    </div>
  );
}
