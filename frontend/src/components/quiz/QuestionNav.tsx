import { Button } from '../ui/Button';
import './QuestionNav.css';

type QuestionNavProps = {
  currentIndex: number;
  total: number;
  onNavigate: (index: number) => void;
};

export function QuestionNav({ currentIndex, total, onNavigate }: QuestionNavProps) {
  return (
    <div className="question-nav">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onNavigate(currentIndex - 1)}
        disabled={currentIndex <= 0}
      >
        ← Anterior
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onNavigate(currentIndex + 1)}
        disabled={currentIndex >= total - 1}
      >
        Próxima →
      </Button>
    </div>
  );
}
