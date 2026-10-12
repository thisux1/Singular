import { useQuery } from '@tanstack/react-query';
import { fetchQuizSessions } from '../../api/quiz';
import './SessionHistoryList.css';

const MODE_LABELS: Record<string, string> = {
  all: 'Prova completa',
  subjects: 'Disciplinas',
  random: 'Aleatório',
  wrong: 'Revisão de erros',
};

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type SessionHistoryListProps = {
  examId: string;
  currentSessionId: string;
};

export function SessionHistoryList({ examId, currentSessionId }: SessionHistoryListProps) {
  const sessionsQuery = useQuery({
    queryKey: ['quiz-sessions', examId],
    queryFn: () => fetchQuizSessions(examId),
    enabled: Boolean(examId),
    retry: false,
  });

  const sessions = (sessionsQuery.data ?? []).filter((session) => session.finishedAt !== null);

  if (sessionsQuery.isLoading || sessions.length === 0) {
    return null;
  }

  return (
    <div className="session-history">
      <h3 className="session-history__title">Histórico de Simulações</h3>
      <ul className="session-history__list">
        {sessions.slice(0, 8).map((session) => {
          const isCurrent = session.sessionId === currentSessionId;
          const score = session.score !== null ? Math.round(session.score) : null;

          return (
            <li
              key={session.sessionId}
              className={`session-history__item ${isCurrent ? 'session-history__item--current' : ''}`}
            >
              <span className="session-history__date">{formatDate(session.finishedAt)}</span>
              <span className="session-history__mode">{MODE_LABELS[session.mode] ?? session.mode}</span>
              <span
                className={`session-history__score ${
                  score !== null && score >= 70 ? 'session-history__score--ok' : ''
                }`}
              >
                {score !== null ? `${score}%` : '—'}
              </span>
              {isCurrent ? <span className="session-history__current-tag">atual</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
