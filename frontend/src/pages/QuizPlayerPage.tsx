import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { apiFetch } from '../api/client';
import { fetchExamQuestions } from '../api/exams';
import { submitAnswer } from '../api/quiz';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import { getSessionByExamId } from './quizSessionStorage';
import './QuizPlayerPage.css';

type Feedback = {
  isCorrect: boolean;
  correctAnswer: string | null;
};

export function QuizPlayerPage() {
  const { examId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const sessionFromQuery = searchParams.get('session');
  const sessionId = useMemo(() => sessionFromQuery ?? getSessionByExamId(examId), [examId, sessionFromQuery]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [showContextMobile, setShowContextMobile] = useState(false);

  const questionsQuery = useQuery({
    queryKey: ['quiz-player-questions', examId],
    queryFn: () => fetchExamQuestions(examId),
    enabled: Boolean(examId),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: ({ questionId, optionId }: { questionId: string; optionId: string }) => {
      if (!sessionId) {
        throw new Error('Sessão de simulação corrompida.');
      }
      return submitAnswer(sessionId, questionId, optionId);
    },
    onSuccess: (result) => {
      setFeedback(result);
      setAnsweredCount((value) => value + 1);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha na transmissão do vetor.', 'error');
    },
  });

  const finishMutation = useMutation({
    mutationFn: () => {
      if (!sessionId) {
        throw new Error('Sessão de simulação corrompida.');
      }

      return apiFetch<{ sessionId: string }>(`/quiz/${sessionId}/finish`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      if (!sessionId) {
        return;
      }
      navigate(`/quiz/${sessionId}/result`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Erro ao colapsar simulação.', 'error');
    },
  });

  if (!sessionId) {
    return (
      <section className="quiz-player page page-container">
        <div className="quiz-player__premium-card quiz-player__premium-card--error">
          <p>Conexão com a simulação perdida. Reinicie através do painel principal.</p>
          <Button variant="ghost" onClick={() => navigate(`/exam/${examId}`)}>
            Abortar
          </Button>
        </div>
      </section>
    );
  }

  if (questionsQuery.isLoading) {
    return (
      <section className="quiz-player page page-container">
        <div className="quiz-player__premium-card">
          <Skeleton width="35%" height="24px" />
          <Skeleton className="quiz-player__skeleton-gap" width="100%" height="32px" />
          <Skeleton className="quiz-player__skeleton-gap" width="100%" height="56px" />
          <Skeleton className="quiz-player__skeleton-gap" width="100%" height="56px" />
        </div>
      </section>
    );
  }

  if (questionsQuery.isError || !questionsQuery.data || questionsQuery.data.length === 0) {
    return (
      <section className="quiz-player page page-container">
        <div className="quiz-player__premium-card quiz-player__premium-card--error">
          <p>Ruptura no acesso aos fragmentos. Os dados não puderam ser materializados.</p>
          <Button variant="ghost" onClick={() => void questionsQuery.refetch()}>
            Tentar Reconexão
          </Button>
        </div>
      </section>
    );
  }

  const questions = questionsQuery.data;
  const current = questions[currentIndex];

  if (!current) {
    return null;
  }

  const progressValue = Math.round((answeredCount / questions.length) * 100);
  const hasContext = Boolean(current.contextText);

  return (
    <section className="quiz-player page page-container" data-has-context={hasContext ? 'true' : 'false'}>
      {hasContext && (
        <>
          <aside className="quiz-player__context-panel" data-open={showContextMobile ? 'true' : 'false'}>
            <div className="quiz-player__context-close">
               <Button variant="ghost" onClick={() => setShowContextMobile(false)}>Ocultar Texto Base</Button>
            </div>
            <div className="quiz-player__context-card">
               <h3 className="quiz-player__context-title">Arquivo Base Recuperado</h3>
               <div className="quiz-player__context-text">{current.contextText}</div>
            </div>
          </aside>
          
          <div className="quiz-player__mobile-context-toggle">
            <Button onClick={() => setShowContextMobile(true)}>
              Acessar Arquivo Base
            </Button>
          </div>
        </>
      )}

      <div className="quiz-player__main-column">
        <div className="quiz-player__terminal">
          <div className="quiz-player__premium-glow" />

          <header className="quiz-player__header">
            <div>
              <h1 className="quiz-player__title">Simulação Ativa</h1>
              <p className="quiz-player__subtitle">Analise os vetores e confirme a rota.</p>
            </div>
          </header>

          <div className="quiz-player__content">
            <div className="quiz-player__progress-container">
              <div className="quiz-player__meta">
                <span className="quiz-player__meta-label">Fragmento {currentIndex + 1} de {questions.length}</span>
                <span className="quiz-player__meta-value">{progressValue}% Resolvido</span>
              </div>
              <div className="quiz-player__progress-track">
                <div 
                  className="quiz-player__progress-fill" 
                  style={{ width: `${progressValue}%` }}
                />
              </div>
            </div>

            <h2 className="quiz-player__question">{current.questionText}</h2>

            <div className="quiz-player__options">
              {current.options.map((option) => {
                const letter = option.trim().charAt(0).toUpperCase();
                const isSelected = selectedOption === letter;
                const isCorrectOption = feedback?.correctAnswer === letter;

                let state: 'idle' | 'correct' | 'incorrect' | 'revealed-correct' = 'idle';
                if (feedback && isSelected && feedback.isCorrect) {
                  state = 'correct';
                } else if (feedback && isSelected && !feedback.isCorrect) {
                  state = 'incorrect';
                } else if (feedback && isCorrectOption) {
                  state = 'revealed-correct'; // Was not selected, but is the correct answer
                }

                return (
                  <button
                    key={option}
                    type="button"
                    className={`quiz-option quiz-option--${state} ${isSelected ? 'quiz-option--selected' : ''}`}
                    disabled={Boolean(feedback) || submitMutation.isPending}
                    onClick={() => {
                      setSelectedOption(letter);
                      submitMutation.mutate({
                        questionId: current.id,
                        optionId: letter,
                      });
                    }}
                  >
                    <span className="quiz-option__letter">{letter}</span>
                    <span className="quiz-option__text">{option}</span>
                  </button>
                );
              })}
            </div>

            {feedback ? (
              <div className={`quiz-player__feedback quiz-player__feedback--${feedback.isCorrect ? 'ok' : 'error'}`}>
                <div className="quiz-player__feedback-icon">
                  {feedback.isCorrect ? '✓' : '⚠'}
                </div>
                <div className="quiz-player__feedback-text">
                  {feedback.isCorrect ? (
                    <strong>Vetor Confirmado. Rota estabilizada.</strong>
                  ) : (
                    <>
                      <strong>Anomalia Detectada.</strong> O vetor correto era a alternativa <span className="quiz-player__feedback-highlight">{feedback.correctAnswer ?? '-'}</span>.
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <footer className="quiz-player__footer">
            <Button
              size="lg"
              onClick={() => {
                if (currentIndex + 1 >= questions.length) {
                  finishMutation.mutate();
                  return;
                }

                setCurrentIndex((value) => value + 1);
                setSelectedOption(null);
                setFeedback(null);
                setShowContextMobile(false);
              }}
              loading={finishMutation.isPending}
              disabled={!feedback}
            >
              {currentIndex + 1 >= questions.length ? 'Colapsar Simulação (Finalizar)' : 'Próximo Fragmento'}
            </Button>
          </footer>
        </div>
      </div>    </section>
  );
}
