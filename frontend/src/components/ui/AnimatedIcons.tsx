import './AnimatedIcons.css';

interface AnimatedFileIconProps {
  selected: boolean;
  type?: 'base' | 'check';
}

export function AnimatedFileIcon({ selected, type = 'base' }: AnimatedFileIconProps) {
  return (
    <svg 
      className={`animated-icon ${selected ? 'animated-icon--selected' : ''}`} 
      viewBox="0 0 24 24" 
      width="40" 
      height="40" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path className="icon-path icon-outline" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline className="icon-path icon-fold" points="13 2 13 9 20 9" />
      
      {/* If selected, draw a checkmark, else if idle, show a subtle pulse/dash based on type */}
      {selected ? (
        <path className="icon-path icon-check" d="M9 15l2 2 4-4" />
      ) : type === 'base' ? (
        <line className="icon-path icon-idle-line" x1="9" y1="13" x2="15" y2="13" />
      ) : (
        <circle className="icon-path icon-idle-circle" cx="12" cy="14" r="2" />
      )}
    </svg>
  );
}
