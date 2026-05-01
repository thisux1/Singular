import './TerminalTab.css';

export type TerminalTabVariant = 'processing' | 'reviewing' | 'completed' | 'failed' | 'default';

interface TerminalTabProps {
  label: string;
  variant?: TerminalTabVariant;
  className?: string;
}

export function TerminalTab({ label, variant = 'default', className = '' }: TerminalTabProps) {
  return (
    <div className={`terminal-tab terminal-tab--${variant} ${className}`.trim()}>
      <div className="terminal-tab__inner">
        {label}
      </div>
    </div>
  );
}
