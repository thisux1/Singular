import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getApiErrorCode } from '../api/client';
import { fetchExam, fetchExamQuestions } from '../api/exams';
import { startQuiz, type QuizMode } from '../api/quiz';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import { saveExamSession } from './quizSessionStorage';
import './QuizSetupPage.css';

type ModeId = QuizMode;

const MODE_ORDER: ModeId[] = ['all', 'subjects', 'random', 'wrong'];

const MODE_META: Record<ModeId, { title: string; description: string; icon: ReactNode }> = {
  all: {
    title: 'Prova Completa',
    description: 'Todos os fragmentos na ordem original do documento.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" />
        <line x1="8" y1="8" x2="16" y2="8" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="13" y2="16" />
      </svg>
    ),
  },
  subjects: {
    title: 'Por Disciplina',
    description: 'Foque nos setores que importam. Seleção múltipla.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" />
        <rect x="13" y="3" width="8" height="8" />
        <rect x="3" y="13" width="8" height="8" />
        <rect x="13" y="13" width="8" height="8" />
      </svg>
    ),
  },
  random: {
    title: 'Aleatório',
    description: 'Amostra randômica do banco — simulado relâmpago.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    ),
  },
  wrong: {
    title: 'Revisar Erros',
    description: 'Somente vetores que você errou em simulações anteriores.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    ),
  },
};

export function QuizSetupPage() {
  const { examId = '' } = useParams();
  const navigate = useNavigate();

  const [mode, setMode] = useState<ModeId>('all');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [randomCount, setRandomCount] = useState(20);
  const [shuffle, setShuffle] = useState(false);

  const examQuery = useQuery({
    queryKey: ['quiz-setup-exam', examId],
    queryFn: () => fetchExam(examId),
    enabled: Boolean(examId),
    retry: false,
  });

  const questionsQuery = useQuery({
    queryKey: ['quiz-setup-questions', examId],
    queryFn: () => fetchExamQuestions(examId),
    enabled: Boolean(examId),
    retry: false,
  });

  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);

  const subjectStats = useMemo(() => {
    const stats = new Map<string, number>();
    let unclassified = 0;

    for (const question of questions) {
      const subject = question.subject?.trim();
      if (subject) {
        stats.set(subject, (stats.get(subject) ?? 0) + 1);
      } else {
        unclassified += 1;
      }
    }

    return {
      entries: Array.from(stats.entries()).sort((a, b) => b[1] - a[1]),
      unclassified,
    };
  }, [questions]);

  const totalQuestions = examQuery.data?.totalQuestions ?? questions.length;

  const startMutation = useMutation({
    mutationFn: () =>
      startQuiz({
        examId,
        mode,
        subjects: mode === 'subjects' ? selectedSubjects : undefined,
        count: mode === 'random' ? randomCount : undefined,
        shuffle: mode === 'all' ? shuffle : undefined,
      }),
    onSuccess: (session) => {
      saveExamSession(examId, session.sessionId, session.questionIds);
      navigate(`/quiz/${examId}?session=${session.sessionId}`);
    },
    onError: (error) => {
      const code = getApiErrorCode(error);
      if (code === 'NO_WRONG_ANSWERS') {
        toast('Sem erros registrados nesta prova para revisar.', 'warning');
        return;
      }
      if (code === 'SUBJECTS_EMPTY') {
        toast('Nenhuma questão encontrada para as disciplinas selecionadas.', 'warning');
        return;
      }

      toast(error instanceof Error ? error.message : 'Falha ao iniciar simulação.', 'error');
    },
  });

  const toggleSubject = (subject: string) => {
    setSelectedSubjects((current) =>
      current.includes(subject)
        ? current.filter((item) => item !== subject)
        : [...current, subject],
    );
  };

  if (examQuery.isLoading || questionsQuery.isLoading) {
    return (
      <section className="quiz-setup page page-container">
        <div className="quiz-setup__terminal">
          <Skeleton width="40%" height="32px" />
          <Skeleton className="quiz-setup__skeleton-gap" width="65%" height="16px" />
          <div className="quiz-setup__modes quiz-setup__skeleton-gap">
            <Skeleton width="100%" height="140px" />
            <Skeleton width="100%" height="140px" />
            <Skeleton width="100%" height="140px" />
            <Skeleton width="100%" height="140px" />
          </div>
        </div>
      </section>
    );
  }

  if (examQuery.isError || questionsQuery.isError || !examQuery.data) {
    return (
      <section className="quiz-setup page page-container">
        <div className="quiz-setup__terminal quiz-setup__terminal--error">
          <p>Simulação indisponível: os dados da prova não puderam ser lidos.</p>
          <Button variant="ghost" onClick={() => navigate(`/exam/${examId}`)}>
            Voltar ao painel
          </Button>
        </div>
      </section>
    );
  }

  const exam = examQuery.data;
  const maxRandom = Math.max(questions.length, 1);
  const minRandom = Math.min(5, maxRandom); // backend clampa count em ≥5 (clampQuestionCount)
  const effectiveRandomCount = Math.min(Math.max(randomCount, minRandom), maxRandom);
  const subjectsReady = subjectStats.entries.length > 0;

  const estimatedCount =
    mode === 'all'
      ? totalQuestions
      : mode === 'subjects'
        ? subjectStats.entries
            .filter(([subject]) => selectedSubjects.includes(subject))
            .reduce((sum, [, count]) => sum + count, 0)
        : mode === 'random'
          ? effectiveRandomCount
          : null; // wrong: só descobrimos no start

  const canStart =
    startMutation.isPending === false &&
    (mode === 'all'
      ? totalQuestions > 0
      : mode === 'subjects'
        ? selectedSubjects.length > 0
        : mode === 'random'
          ? maxRandom > 0
          : true);

  return (
    <section className="quiz-setup page page-container">
      <div className="quiz-setup__terminal">
        <div className="quiz-setup__premium-glow" />

        <header className="quiz-setup__header">
          <h1 className="quiz-setup__title">Configurar Simulação</h1>
          <p className="quiz-setup__subtitle">
            SYS.ID // {exam.title} — {totalQuestions} fragmentos disponíveis
          </p>
        </header>

        <div className="quiz-setup__content">
          <div className="quiz-setup__modes" role="radiogroup" aria-label="Modo de simulação">
            {MODE_ORDER.map((modeId) => {
              const meta = MODE_META[modeId];
              const isSelected = mode === modeId;

              return (
                <div
                  key={modeId}
                  className={`mode-card ${isSelected ? 'mode-card--selected' : ''}`}
                >
                  <button
                    type="button"
                    className="mode-card__select"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setMode(modeId)}
                  >
                    <span className="mode-card__icon">{meta.icon}</span>
                    <span className="mode-card__body">
                      <span className="mode-card__title">{meta.title}</span>
                      <span className="mode-card__description">{meta.description}</span>
                      {modeId === 'all' ? (
                        <span className="mode-card__meta">{totalQuestions} questões</span>
                      ) : null}
                      {modeId === 'random' ? (
                        <span className="mode-card__meta">até {maxRandom} questões</span>
                      ) : null}
                      {modeId === 'wrong' ? (
                        <span className="mode-card__meta">requer erros de sessões anteriores</span>
                      ) : null}
                    </span>
                    <span className="mode-card__radio" aria-hidden="true" />
                  </button>

                  {modeId === 'subjects' && isSelected ? (
                    <div className="mode-card__panel">
                      {subjectsReady ? (
                        <>
                          <p className="mode-card__panel-label">Setores detectados</p>
                          <div className="subject-picker">
                            {subjectStats.entries.map(([subject, count]) => {
                              const checked = selectedSubjects.includes(subject);
                              return (
                                <label
                                  key={subject}
                                  className={`subject-picker__chip ${checked ? 'subject-picker__chip--on' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleSubject(subject)}
                                  />
                                  <span className="subject-picker__name">{subject}</span>
                                  <span className="subject-picker__count">{count}</span>
                                </label>
                              );
                            })}
                          </div>
                          {subjectStats.unclassified > 0 ? (
                            <p className="mode-card__panel-note">
                              {subjectStats.unclassified} questão(ões) sem disciplina não entram
                              neste modo.
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <p className="mode-card__panel-note">
                          Nenhuma disciplina classificada nesta prova ainda.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {modeId === 'random' && isSelected ? (
                    <div className="mode-card__panel">
                      <label className="mode-card__panel-label" htmlFor="random-count">
                        Tamanho da amostra — <strong>{effectiveRandomCount}</strong> questões
                      </label>
                      <input
                        id="random-count"
                        className="mode-card__slider"
                        type="range"
                        min={minRandom}
                        max={maxRandom}
                        value={effectiveRandomCount}
                        onChange={(event) => setRandomCount(Number(event.target.value))}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {mode === 'all' ? (
            <label className="quiz-setup__shuffle">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={(event) => setShuffle(event.target.checked)}
              />
              <span>Embaralhar ordem dos fragmentos</span>
            </label>
          ) : null}
        </div>

        <footer className="quiz-setup__footer">
          <div className="quiz-setup__estimate" aria-live="polite">
            {estimatedCount !== null ? (
              <>
                <span className="quiz-setup__estimate-value">{estimatedCount}</span>
                <span className="quiz-setup__estimate-label">
                  fragmento{estimatedCount === 1 ? '' : 's'} na simulação
                </span>
              </>
            ) : (
              <span className="quiz-setup__estimate-label">conjunto resolvido no servidor</span>
            )}
          </div>
          <div className="quiz-setup__footer-actions">
            <Button variant="ghost" onClick={() => navigate(`/exam/${examId}`)}>
              Abortar
            </Button>
            <Button
              size="lg"
              onClick={() => startMutation.mutate()}
              loading={startMutation.isPending}
              disabled={!canStart}
            >
              Iniciar Simulação
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
