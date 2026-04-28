import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { fetchQuizResult, startQuiz } from '../api/quiz';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import { getExamBySessionId, saveExamSession } from './quizSessionStorage';
import './QuizResultPage.css';

export function QuizResultPage() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();

  const examId = useMemo(() => getExamBySessionId(quizId), [quizId]);

  const resultQuery = useQuery({
    queryKey: ['quiz-result', quizId],
    queryFn: () => fetchQuizResult(quizId),
    retry: false,
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      if (!examId) {
        throw new Error('Não foi possível identificar o arquivo primário para reiniciar a simulação.');
      }
      return startQuiz(examId);
    },
    onSuccess: (session) => {
      if (!examId) {
        return;
      }

      saveExamSession(examId, session.sessionId);
      navigate(`/quiz/${examId}?session=${session.sessionId}`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha ao reativar simulação.', 'error');
    },
  });

  if (resultQuery.isLoading) {
    return (
      <section className="quiz-result page page-container">
        <div className="quiz-result__premium-card">
          <Skeleton width="220px" height="64px" />
          <Skeleton className="quiz-result__skeleton-gap" width="180px" height="24px" />
        </div>
      </section>
    );
  }

  if (resultQuery.isError || !resultQuery.data) {
    return (
      <section className="quiz-result page page-container">
        <div className="quiz-result__premium-card quiz-result__premium-card--error">
          <p>Erro crítico. Relatório de simulação corrompido.</p>
          <Button variant="ghost" onClick={() => void resultQuery.refetch()}>
            Tentar Reconexão
          </Button>
        </div>
      </section>
    );
  }

  const result = resultQuery.data;
  const percentage = Math.round(result.score);
  const isGoodScore = percentage >= 70;

  return (
    <section className="quiz-result page page-container">
      <div className="quiz-result__terminal">
        <div className="quiz-result__premium-glow" />
        
        <header className="quiz-result__header">
          <div className="quiz-result__header-content">
            <h1 className="quiz-result__title">Diagnóstico da Simulação</h1>
            <p className="quiz-result__subtitle">Avaliação do seu desempenho no colapso dos dados.</p>
          </div>
          
          <div className="quiz-result__score-container">
            <div className={`quiz-result__score-circle ${isGoodScore ? 'score--high' : 'score--low'}`}>
              <div className="quiz-result__score-value">{percentage}%</div>
            </div>
            <div className="quiz-result__score-summary">
              Taxa de Sucesso: {result.correct} / {result.total}
            </div>
          </div>
        </header>

        <div className="quiz-result__answers">
          <h2 className="quiz-result__section-title">Análise de Vetores</h2>
          {result.answers.map((answer) => (
            <div key={answer.questionId} className={`quiz-result__answer-card ${answer.isCorrect ? 'answer-card--correct' : 'answer-card--incorrect'}`}>
              <div className="quiz-result__answer-header">
                <div className="quiz-result__question-text">{answer.questionText.slice(0, 160)}...</div>
                <div className={`quiz-result__status-badge ${answer.isCorrect ? 'status-ok' : 'status-err'}`}>
                  {answer.isCorrect ? 'VETOR ESTÁVEL' : 'ANOMALIA'}
                </div>
              </div>

              <div className="quiz-result__answer-details">
                <div className="quiz-result__detail-box">
                  <span className="quiz-result__detail-label">Sua Seleção</span>
                  <strong className={`quiz-result__detail-value ${answer.isCorrect ? 'value-ok' : 'value-err'}`}>
                    {answer.selectedAnswer}
                  </strong>
                </div>
                {!answer.isCorrect && (
                  <div className="quiz-result__detail-box">
                    <span className="quiz-result__detail-label">Vetor Correto</span>
                    <strong className="quiz-result__detail-value value-expected">
                      {answer.correctAnswer ?? '-'}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <footer className="quiz-result__footer">
          <Button size="lg" onClick={() => restartMutation.mutate()} loading={restartMutation.isPending} disabled={!examId}>
            Nova Simulação
          </Button>
          <Button variant="ghost" size="lg" onClick={() => navigate('/')}>
            Retornar ao Terminal
          </Button>
        </footer>
      </div>
    </section>
  );
}
