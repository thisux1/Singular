import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { getApiErrorCode } from '../api/client';
import type { BankQuestion } from '../api/bank';
import { fetchExamQuestions, type Question } from '../api/exams';
import { finishQuiz, submitAnswer } from '../api/quiz';
import { PageViewerModal } from '../components/pdf/PageViewerModal';
import { QuestionNav } from '../components/quiz/QuestionNav';
import { QuizDots, type QuizDotState } from '../components/quiz/QuizDots';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import {
  clearExamSession,
  getExamBySessionId,
  getSessionBankQuestions,
  getSessionByExamId,
  getSessionQuestionIds,
} from './quizSessionStorage';
import './QuizPlayerPage.css';

/** BankQuestion (GET /bank/questions) → Question do player. */
function toPlayerQuestion(question: BankQuestion, index: number): Question {
  return {
    id: question.id,
    // examId real da prova de origem (não o exame sintético kind='bank') —
    // é o que o PageViewerModal precisa para abrir o PDF correto.
    examId: question.examId,
    order: index + 1,
    questionText: question.questionText,
    options: question.options,
    sourcePage: question.sourcePage ?? null,
    difficulty: question.difficulty,
    subject: question.subject,
    topic: question.topic,
    correctAnswer: question.correctAnswer ?? null,
    contextText: question.contextText ?? null,
    annulled: question.annulled,
    requiresPdf: question.hasImage,
    hasImage: question.hasImage,
  };
}

/** Estado local de uma questão já submetida — feedback fica congelado. */
type AnsweredState = {
  selected: string;
  isCorrect: boolean | null; // null = servidor respondeu 409 e não sabemos o gabarito local
  correctAnswer: string | null;
};

export function QuizPlayerPage() {
  const { examId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const sessionFromQuery = searchParams.get('session');
  const sessionId = useMemo(() => sessionFromQuery ?? getSessionByExamId(examId), [examId, sessionFromQuery]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnsweredState>>({});
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [finishModalOpen, setFinishModalOpen] = useState(false);

  /** Timestamp de exibição da questão atual → timeSpentMs no submit.
   *  Inicializado no effect abaixo (performance.now é impuro em render). */
  const shownAtRef = useRef<number>(0);

  // Sessões mode='bank' são ancoradas num exame sintético sem questões
  // próprias — GET /exams/:id/questions retorna 422. O payload completo foi
  // persistido no start (quizSessionStorage); aqui ele é a fonte primária,
  // já ordenado pelo snapshot.
  const bankQuestions = useMemo<Question[] | null>(() => {
    if (!sessionId) {
      return null;
    }

    const stored = getSessionBankQuestions(sessionId);
    if (!stored || stored.length === 0) {
      return null;
    }

    const snapshot = getSessionQuestionIds(sessionId);
    const orderIds = snapshot && snapshot.length > 0 ? snapshot : stored.map((q) => q.id);
    const byId = new Map(stored.map((q) => [q.id, q]));

    const ordered = orderIds
      .map((id, index) => {
        const question = byId.get(id);
        return question ? toPlayerQuestion(question, index) : null;
      })
      .filter((question): question is Question => Boolean(question));

    return ordered.length > 0 ? ordered : null;
  }, [sessionId]);

  const questionsQuery = useQuery({
    queryKey: ['quiz-player-questions', examId],
    queryFn: () => fetchExamQuestions(examId),
    enabled: Boolean(examId) && !bankQuestions,
    retry: false,
  });

  // Conjunto da sessão: snapshot de questionIds salvo no start. Sem snapshot
  // (sessão de outro device), cai no conjunto completo da prova.
  const questions = useMemo(() => {
    if (bankQuestions) {
      return bankQuestions;
    }

    const all = questionsQuery.data ?? [];
    if (!sessionId) {
      return all;
    }

    const snapshot = getSessionQuestionIds(sessionId);
    if (!snapshot || snapshot.length === 0) {
      return all;
    }

    const byId = new Map(all.map((question) => [question.id, question]));
    const ordered = snapshot
      .map((id) => byId.get(id))
      .filter((question): question is Question => Boolean(question));

    return ordered.length > 0 ? ordered : all;
  }, [bankQuestions, questionsQuery.data, sessionId]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= questions.length || index === currentIndex) {
        return;
      }
      setCurrentIndex(index);
      setSelectedOption(null);
      setContextOpen(false);
      shownAtRef.current = performance.now();
    },
    [currentIndex, questions.length],
  );

  const submitMutation = useMutation({
    mutationFn: ({ questionId, optionId }: { questionId: string; optionId: string }) => {
      if (!sessionId) {
        throw new Error('Sessão de simulação corrompida.');
      }
      const timeSpentMs = Math.max(performance.now() - shownAtRef.current, 0);
      return submitAnswer(sessionId, questionId, optionId, timeSpentMs);
    },
    onSuccess: (result, variables) => {
      setAnswers((current) => ({
        ...current,
        [variables.questionId]: {
          selected: variables.optionId,
          isCorrect: result.isCorrect,
          correctAnswer: result.correctAnswer,
        },
      }));
    },
    onError: (error, variables) => {
      const code = getApiErrorCode(error);

      if (code === 'SESSION_FINISHED') {
        toast('Esta sessão já foi finalizada.', 'warning');
        navigate(`/app/quiz/${sessionId}/result`);
        return;
      }

      if (code === 'QUESTION_ALREADY_ANSWERED') {
        // Resposta já gravada (ex.: retomada de sessão). Congela a questão
        // usando o gabarito do payload — seleção original é desconhecida.
        const question = questions.find((item) => item.id === variables.questionId);
        setAnswers((current) => ({
          ...current,
          [variables.questionId]: {
            selected: variables.optionId,
            isCorrect: null,
            correctAnswer: question?.correctAnswer ?? null,
          },
        }));
        return;
      }

      toast(error instanceof Error ? error.message : 'Falha na transmissão do vetor.', 'error');
    },
  });

  const finishMutation = useMutation({
    mutationFn: () => {
      if (!sessionId) {
        throw new Error('Sessão de simulação corrompida.');
      }
      return finishQuiz(sessionId);
    },
    onSuccess: () => {
      if (!sessionId) {
        return;
      }
      clearExamSession(getExamBySessionId(sessionId) ?? examId, sessionId);
      navigate(`/app/quiz/${sessionId}/result`);
    },
    onError: (error) => {
      setFinishModalOpen(false);
      toast(error instanceof Error ? error.message : 'Erro ao colapsar simulação.', 'error');
    },
  });

  const current = questions[currentIndex];
  const currentAnswered: AnsweredState | null = current ? (answers[current.id] ?? null) : null;

  // Reseta o timer quando a questão muda (primeira render inclusa).
  useEffect(() => {
    shownAtRef.current = performance.now();
  }, [current?.id]);

  const handleSelect = (question: Question, letter: string) => {
    if (answers[question.id] || question.annulled || submitMutation.isPending) {
      return;
    }
    setSelectedOption(letter);
    submitMutation.mutate({ questionId: question.id, optionId: letter });
  };

  const dotState = useCallback(
    (index: number): QuizDotState => {
      const question = questions[index];
      if (!question) {
        return 'pending';
      }
      const answered = answers[question.id];
      if (answered) {
        if (answered.isCorrect === true) {
          return 'correct';
        }
        if (answered.isCorrect === false) {
          return 'wrong';
        }
        return 'answered';
      }
      if (question.annulled) {
        return 'annulled';
      }
      return 'pending';
    },
    [answers, questions],
  );

  const requestFinish = () => {
    const pending = questions.length - Object.keys(answers).length;
    // Anuladas não exigem resposta — desconta do pendente.
    const annulled = questions.filter((question) => question.annulled && !answers[question.id]).length;
    const trulyPending = pending - annulled;

    if (trulyPending > 0) {
      setFinishModalOpen(true);
      return;
    }

    finishMutation.mutate();
  };

  if (!sessionId) {
    return (
      <section className="quiz-player page page-container page--padded">
        <div className="terminal terminal--error quiz-player__terminal quiz-player__terminal--error">
          <p>Conexão com a simulação perdida. Reinicie através do painel principal.</p>
          <Button variant="ghost" onClick={() => navigate(`/app/exam/${examId}`)}>
            Abortar
          </Button>
        </div>
      </section>
    );
  }

  if (!bankQuestions && questionsQuery.isLoading) {
    return (
      <section className="quiz-player page page-container page--padded">
        <div className="terminal quiz-player__terminal">
          <div className="terminal__section quiz-player__content">
            <Skeleton width="35%" height="24px" />
            <Skeleton className="quiz-player__skeleton-gap skeleton-gap" width="100%" height="32px" />
            <Skeleton className="quiz-player__skeleton-gap skeleton-gap" width="100%" height="56px" />
            <Skeleton className="quiz-player__skeleton-gap skeleton-gap" width="100%" height="56px" />
          </div>
        </div>
      </section>
    );
  }

  if (
    questions.length === 0 ||
    !current ||
    (!bankQuestions && (questionsQuery.isError || !questionsQuery.data))
  ) {
    return (
      <section className="quiz-player page page-container page--padded">
        <div className="terminal terminal--error quiz-player__terminal quiz-player__terminal--error">
          <p>Ruptura no acesso aos fragmentos. Os dados não puderam ser materializados.</p>
          <Button variant="ghost" onClick={() => void questionsQuery.refetch()}>
            Tentar Reconexão
          </Button>
        </div>
      </section>
    );
  }

  const answeredCount = Object.keys(answers).length;
  const progressValue = Math.round((answeredCount / questions.length) * 100);
  const hasContext = Boolean(current.contextText);
  const hasSourcePage = Boolean(current.requiresPdf || current.hasImage || current.sourcePage);
  const feedback = currentAnswered;

  return (
    <section className="quiz-player page page-container page--padded">
      <div className="quiz-player__main-column">
        <div className="terminal quiz-player__terminal">
          <div className="premium-glow quiz-player__premium-glow" />

          <header className="terminal__header quiz-player__header">
            <div>
              <h1 className="page-title quiz-player__title">Simulação Ativa</h1>
              <p className="page-subtitle quiz-player__subtitle">Analise os vetores e confirme a rota.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setExitModalOpen(true)}>
              Sair
            </Button>
          </header>

          <div className="terminal__section quiz-player__content">
            <QuizDots
              total={questions.length}
              currentIndex={currentIndex}
              getState={dotState}
              onNavigate={goTo}
              keyboardEnabled={!pdfOpen && !exitModalOpen && !finishModalOpen}
            />

            <div className="quiz-player__progress-container">
              <div className="quiz-player__meta">
                <span className="quiz-player__meta-label">
                  Fragmento {currentIndex + 1} de {questions.length}
                </span>
                <span className="quiz-player__meta-value">{progressValue}% Resolvido</span>
              </div>
              <div className="quiz-player__progress-track">
                <div className="quiz-player__progress-fill" style={{ width: `${progressValue}%` }} />
              </div>
            </div>

            {hasContext ? (
              <div className="quiz-player__context-inline">
                <button
                  type="button"
                  className="text-btn quiz-player__context-toggle"
                  onClick={() => setContextOpen((value) => !value)}
                  aria-expanded={contextOpen}
                >
                  <span className="quiz-player__context-toggle-icon">{contextOpen ? '−' : '+'}</span>
                  Texto-base
                </button>
                {contextOpen ? (
                  <div className="quiz-player__context-body">{current.contextText}</div>
                ) : null}
              </div>
            ) : null}

            <div className="quiz-player__badges">
              {current.annulled ? (
                <span className="badge quiz-player__badge quiz-player__badge--annulled">
                  ⚠ anulada — ponto automático
                </span>
              ) : null}
              {current.subject ? (
                <span className="badge quiz-player__badge">{current.subject}</span>
              ) : null}
              {hasSourcePage ? (
                <button
                  type="button"
                  className="badge quiz-player__badge quiz-player__badge--page"
                  onClick={() => setPdfOpen(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  ver página{current.sourcePage ? ` ${current.sourcePage}` : ''}
                </button>
              ) : null}
            </div>

            <h2 className="quiz-player__question">{current.questionText}</h2>

            <div className="quiz-player__options">
              {current.options.map((option, index) => {
                const prefix = option.trim().match(/^([A-Ea-e])\s*[).:-]\s*/);
                const letter = prefix ? prefix[1].toUpperCase() : String.fromCharCode(65 + index);
                const label = prefix ? option.trim().slice(prefix[0].length) : option;
                const isSelected = feedback
                  ? feedback.selected === letter
                  : selectedOption === letter;
                const isCorrectOption =
                  (feedback?.correctAnswer ?? current.correctAnswer ?? null) === letter;

                let state: 'idle' | 'correct' | 'incorrect' | 'revealed-correct' | 'disabled' = 'idle';
                if (current.annulled) {
                  state = 'disabled';
                } else if (feedback && isSelected && feedback.isCorrect === true) {
                  state = 'correct';
                } else if (feedback && isSelected && feedback.isCorrect === false) {
                  state = 'incorrect';
                } else if (feedback && isCorrectOption) {
                  state = 'revealed-correct';
                }

                return (
                  <button
                    key={index}
                    type="button"
                    className={`quiz-option quiz-option--${state} ${isSelected ? 'quiz-option--selected' : ''}`}
                    disabled={Boolean(feedback) || Boolean(current.annulled) || submitMutation.isPending}
                    onClick={() => handleSelect(current, letter)}
                  >
                    <span className="quiz-option__letter">{letter}</span>
                    <span className="quiz-option__text">{label}</span>
                  </button>
                );
              })}
            </div>

            <div role="status" aria-live="polite" className="quiz-player__live-region">
              {current.annulled ? (
                <div className="quiz-player__feedback quiz-player__feedback--annulled">
                  <div className="quiz-player__feedback-icon">⚠</div>
                  <div className="quiz-player__feedback-text">
                    <strong>Fragmento anulado pela banca.</strong> O ponto é contabilizado
                    automaticamente — nenhuma seleção necessária.
                  </div>
                </div>
              ) : feedback ? (
                <div
                  className={`quiz-player__feedback quiz-player__feedback--${
                    feedback.isCorrect === true ? 'ok' : feedback.isCorrect === false ? 'error' : 'neutral'
                  }`}
                >
                  <div className="quiz-player__feedback-icon">
                    {feedback.isCorrect === true ? '✓' : feedback.isCorrect === false ? '✕' : 'ℹ'}
                  </div>
                  <div className="quiz-player__feedback-text">
                    {feedback.isCorrect === true ? (
                      <strong>Vetor Confirmado. Rota estabilizada.</strong>
                    ) : feedback.isCorrect === false ? (
                      <>
                        <strong>Anomalia Detectada.</strong> O vetor correto era a alternativa{' '}
                        <span className="quiz-player__feedback-highlight">
                          {feedback.correctAnswer ?? '-'}
                        </span>
                        .
                      </>
                    ) : (
                      <>
                        <strong>Resposta já registrada.</strong> O vetor correto é a alternativa{' '}
                        <span className="quiz-player__feedback-highlight">
                          {feedback.correctAnswer ?? '-'}
                        </span>
                        .
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <footer className="terminal__footer quiz-player__footer">
            <QuestionNav currentIndex={currentIndex} total={questions.length} onNavigate={goTo} />
            <Button size="lg" onClick={requestFinish} loading={finishMutation.isPending}>
              Colapsar Simulação
            </Button>
          </footer>
        </div>
      </div>

      {hasSourcePage ? (
        <PageViewerModal
          open={pdfOpen}
          onClose={() => setPdfOpen(false)}
          examId={current.examId}
          page={current.sourcePage ?? 1}
        />
      ) : null}

      <Modal
        open={exitModalOpen}
        onClose={() => setExitModalOpen(false)}
        title="Abortar simulação?"
        description="Suas respostas já enviadas ficam gravadas no servidor — você pode retomar depois pelo painel da prova."
      >
        <div className="quiz-player__modal-actions">
          <Button variant="ghost" onClick={() => setExitModalOpen(false)}>
            Continuar na simulação
          </Button>
          <Button
            variant="danger"
            onClick={() => navigate(bankQuestions ? '/app/banco' : `/app/exam/${examId}`)}
          >
            Sair
          </Button>
        </div>
      </Modal>

      <Modal
        open={finishModalOpen}
        onClose={() => setFinishModalOpen(false)}
        title="Fragmentos pendentes"
        description="Existem fragmentos sem vetor selecionado — eles contam como erro no resultado. Finalizar mesmo assim?"
      >
        <div className="quiz-player__modal-actions">
          <Button variant="ghost" onClick={() => setFinishModalOpen(false)}>
            Voltar aos fragmentos
          </Button>
          <Button onClick={() => finishMutation.mutate()} loading={finishMutation.isPending}>
            Finalizar mesmo assim
          </Button>
        </div>
      </Modal>
    </section>
  );
}
