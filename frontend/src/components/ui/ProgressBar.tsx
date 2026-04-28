import './ProgressBar.css';

interface ProgressBarProps {
  value: number; // 0-100
  variant?: 'default' | 'correct' | 'incorrect';
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  variant = 'default',
  size = 'md',
  showLabel = false,
  className = '',
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className={`progress progress--${variant} progress--${size} ${className}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${clamped}% completo`}
    >
      <div
        className="progress__fill"
        style={{ width: `${clamped}%` }}
      />
      {showLabel ? (
        <span className="progress__label text-mono">{clamped}%</span>
      ) : null}
    </div>
  );
}
