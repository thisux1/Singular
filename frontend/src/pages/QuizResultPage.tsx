import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, getApiErrorCode } from '../api/client';
import { fetchQuizResult, startQuiz } from '../api/quiz';
import { fetchStatsSummary } from '../api/stats';
import { DashboardCharts } from '../components/quiz/DashboardCharts';
import { ExplainPanel } from '../components/quiz/ExplainPanel';
import { SessionHistoryList } from '../components/quiz/SessionHistoryList';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import { getExamBySessionId, saveExamSession } from './quizSessionStorage';
import './QuizResultPage.css';

const MODE_LABELS: Record<string, string> = {
  all: 'Prova completa',
  subjects: 'Disciplinas',
  random: 'Aleatório',
  wrong: 'Revisão de erros',
  bank: 'Banco de questões',
};

function formatDuration(totalMs: number | null): string {
  if (totalMs === null || !Number.isFinite(totalMs) || totalMs < 0) {
    return '—';
  }
  const totalSeconds = Math.round(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function QuizResultPage() {
  const { quizId = '' } = useParams();
  const navigate = useNavigate();

  const resultQuery = useQuery({
    queryKey: ['quiz-result', quizId],
    queryFn: () => fetchQuizResult(quizId),
    retry: false,
  });

  // Gamificação — graceful: se /stats/summary falhar, o painel não renderiza.
  const summaryQuery = useQuery({
    queryKey: ['stats-summary'],
    queryFn: fetchStatsSummary,
    staleTime: 60_000,
    retry: false,
  });
  const summary = summaryQuery.data ?? null;

  // examId: o payload do result carrega examId (contrato atual); storage é
  // fallback para sessões finalizadas antes do campo existir.
  const examId = useMemo(
    () => resultQuery.data?.examId ?? getExamBySessionId(quizId),
    [resultQuery.data, quizId],
  );

  const restartWrongMutation = useMutation({
    mutationFn: async () => {
      if (!examId) {
        throw new Error('Prova de origem não identificada.');
      }
      return startQuiz({ examId, mode: 'wrong' });
    },
    onSuccess: (session) => {
      if (!examId) {
        return;
      }
      saveExamSession(examId, session.sessionId, session.questionIds);
      navigate(`/app/quiz/${examId}?session=${session.sessionId}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 422) {
        toast('Sem erros registrados nesta prova para revisar.', 'warning');
        return;
      }
      toast(error instanceof Error ? error.message : 'Falha ao iniciar revisão de erros.', 'error');
    },
  });

  if (resultQuery.isLoading) {
    return (
      <section className="quiz-result page page-container page--padded">
        <div className="terminal quiz-result__terminal">
          <div className="terminal__section quiz-result__content">
            <Skeleton width="220px" height="64px" />
            <Skeleton className="quiz-result__skeleton-gap skeleton-gap" width="180px" height="24px" />
            <Skeleton className="quiz-result__skeleton-gap skeleton-gap" width="100%" height="220px" />
          </div>
        </div>
      </section>
    );
  }

  if (resultQuery.isError || !resultQuery.data) {
    const error = resultQuery.error;
    const notFinished =
      error instanceof ApiError &&
      error.status === 409 &&
      getApiErrorCode(error) === 'SESSION_NOT_FINISHED';

    if (notFinished) {
      const fallbackExamId = getExamBySessionId(quizId);
      return (
        <section className="quiz-result page page-container page--padded">
          <div className="terminal terminal--error quiz-result__terminal quiz-result__terminal--error">
            <div>
              <p>Simulação ainda em andamento — o relatório só existe após o colapso.</p>
            </div>
            {fallbackExamId ? (
              <Button onClick={() => navigate(`/app/quiz/${fallbackExamId}?session=${quizId}`)}>
                Retomar sessão
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => navigate('/app')}>
                Voltar ao terminal
              </Button>
            )}
          </div>
        </section>
      );
    }

    return (
      <section className="quiz-result page page-container page--padded">
        <div className="terminal terminal--error quiz-result__terminal quiz-result__terminal--error">
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
  // Sessões bank: o examId é o exame sintético kind='bank' — modos de prova
  // (setup/wrong) não se aplicam; a navegação volta para /app/banco.
  const isBankMode = result.mode === 'bank';

  const answeredAnswers = result.answers;
  const blankCount = Math.max(result.total - result.answered, 0);
  const wrongCount = answeredAnswers.filter((answer) => !answer.isCorrect && !answer.annulled).length;
  const correctCount = Math.max(result.total - blankCount - wrongCount, 0);

  const avgTimeMs =
    result.totalTimeMs !== null && result.answered > 0
      ? result.totalTimeMs / result.answered
      : null;

  const subjectRanking = result.perSubject
    .map((stat) => ({
      ...stat,
      percent: stat.total > 0 ? stat.correct / stat.total : 0,
    }))
    .sort((a, b) => b.percent - a.percent);
  const bestSubject = subjectRanking[0] ?? null;
  const worstSubject = subjectRanking.length > 1 ? subjectRanking[subjectRanking.length - 1] : null;

  return (
    <section className="quiz-result page page-container page--padded">
      <div className="terminal quiz-result__terminal">
        <div className="premium-glow quiz-result__premium-glow" />

        <header className="terminal__header quiz-result__header">
          <div className="quiz-result__header-content">
            <h1 className="page-title quiz-result__title">Diagnóstico da Simulação</h1>
            <p className="page-subtitle quiz-result__subtitle">
              {MODE_LABELS[result.mode] ?? result.mode} · sessão {result.sessionId.slice(0, 8)}
            </p>

            <div className="quiz-result__stats">
              <div className="stat quiz-result__stat">
                <span className="stat__label quiz-result__stat-label">Tempo total</span>
                <strong className="stat__value quiz-result__stat-value">{formatDuration(result.totalTimeMs)}</strong>
              </div>
              <div className="stat quiz-result__stat">
                <span className="stat__label quiz-result__stat-label">Média / questão</span>
                <strong className="stat__value quiz-result__stat-value">
                  {avgTimeMs !== null ? formatDuration(avgTimeMs) : '—'}
                </strong>
              </div>
              <div className="stat quiz-result__stat">
                <span className="stat__label quiz-result__stat-label">Melhor setor</span>
                <strong className="stat__value quiz-result__stat-value quiz-result__stat-value--warn">
                  {bestSubject ? `${bestSubject.subject} (${Math.round(bestSubject.percent * 100)}%)` : '—'}
                </strong>
              </div>
              <div className="stat quiz-result__stat">
                <span className="stat__label quiz-result__stat-label">Pior setor</span>
                <strong className="stat__value quiz-result__stat-value quiz-result__stat-value--err">
                  {worstSubject ? `${worstSubject.subject} (${Math.round(worstSubject.percent * 100)}%)` : '—'}
                </strong>
              </div>
            </div>
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

        <div className="terminal__section quiz-result__content">
          <DashboardCharts
            correct={correctCount}
            wrong={wrongCount}
            blank={blankCount}
            perSubject={result.perSubject}
          />

          {summary ? (
            <section className="cut cut--b quiz-result__progress" aria-labelledby="quiz-result-progress-title">
              <h2 className="quiz-result__section-title" id="quiz-result-progress-title">
                Progressão
              </h2>

              <div className="quiz-result__progress-stats">
                <div className="stat quiz-result__stat">
                  <span className="stat__label quiz-result__stat-label">Nível</span>
                  <strong className="stat__value quiz-result__stat-value">LV {summary.level}</strong>
                </div>
                <div className="stat quiz-result__stat">
                  <span className="stat__label quiz-result__stat-label">XP total</span>
                  <strong className="stat__value quiz-result__stat-value">
                    {summary.xp.toLocaleString('pt-BR')}
                  </strong>
                </div>
                <div className="stat quiz-result__stat">
                  <span className="stat__label quiz-result__stat-label">Streak</span>
                  <strong className="stat__value quiz-result__stat-value">{summary.streakDays}D</strong>
                </div>
              </div>

              <div className="quiz-result__level-bar">
                <div className="quiz-result__level-bar-meta">
                  <span>LV {summary.level}</span>
                  <span>
                    {Math.round(summary.levelProgressPct)}% → LV {summary.level + 1}
                  </span>
                </div>
                <ProgressBar value={summary.levelProgressPct} />
              </div>

              {summary.badges.length > 0 ? (
                <ul className="quiz-result__badges" aria-label="Badges">
                  {summary.badges.map((badge) => (
                    <li
                      key={badge.id}
                      className={`badge quiz-result__badge ${
                        badge.earned
                          ? 'quiz-result__badge--earned'
                          : 'quiz-result__badge--locked'
                      }`}
                    >
                      <span aria-hidden="true">{badge.earned ? '◈' : '◇'}</span>
                      {badge.label}
                      <span className="sr-only">{badge.earned ? ' (conquistado)' : ' (não conquistado)'}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {examId ? <SessionHistoryList examId={examId} currentSessionId={quizId} /> : null}
        </div>

        <div className="terminal__section quiz-result__answers">
          <h2 className="quiz-result__section-title">Análise de Vetores</h2>
          {answeredAnswers.length === 0 ? (
            <p className="empty quiz-result__empty">Nenhum vetor foi registrado nesta sessão.</p>
          ) : null}
          {answeredAnswers.map((answer) => (
            <div
              key={answer.questionId}
              className={`cut cut--b quiz-result__answer-card ${
                answer.annulled
                  ? 'answer-card--annulled'
                  : answer.isCorrect
                    ? 'answer-card--correct'
                    : 'answer-card--incorrect'
              }`}
            >
              <div className="quiz-result__answer-header">
                <div className="quiz-result__question-text">{answer.questionText}</div>
                <div className="quiz-result__answer-header-side">
                  {answer.annulled ? (
                    <span className="badge quiz-result__status-badge status-annulled">ANULADA</span>
                  ) : (
                    <div
                      className={`badge quiz-result__status-badge ${answer.isCorrect ? 'status-ok' : 'status-err'}`}
                    >
                      {answer.isCorrect ? 'VETOR ESTÁVEL' : 'ANOMALIA'}
                    </div>
                  )}
                </div>
              </div>

              <div className="quiz-result__answer-details">
                <div className="quiz-result__detail-box">
                  <span className="quiz-result__detail-label">Sua Seleção</span>
                  <strong
                    className={`quiz-result__detail-value ${answer.isCorrect ? 'value-ok' : 'value-err'}`}
                  >
                    {answer.selectedAnswer}
                  </strong>
                </div>
                {!answer.isCorrect ? (
                  <div className="quiz-result__detail-box">
                    <span className="quiz-result__detail-label">Vetor Correto</span>
                    <strong className="quiz-result__detail-value value-expected">
                      {answer.correctAnswer ?? '-'}
                    </strong>
                  </div>
                ) : null}
                {answer.subject ? (
                  <div className="quiz-result__detail-box">
                    <span className="quiz-result__detail-label">Setor</span>
                    <strong className="quiz-result__detail-value quiz-result__detail-value--subject">
                      {answer.subject}
                    </strong>
                  </div>
                ) : null}
                {answer.timeSpentMs !== null ? (
                  <div className="quiz-result__detail-box">
                    <span className="quiz-result__detail-label">Tempo</span>
                    <strong className="quiz-result__detail-value quiz-result__detail-value--subject">
                      {formatDuration(answer.timeSpentMs)}
                    </strong>
                  </div>
                ) : null}
                <div className="quiz-result__detail-spacer" />
                <ExplainPanel questionId={answer.questionId} />
              </div>
            </div>
          ))}
        </div>

        <footer className="terminal__footer quiz-result__footer">
          {!isBankMode ? (
            <Button
              size="lg"
              onClick={() => restartWrongMutation.mutate()}
              loading={restartWrongMutation.isPending}
              disabled={!examId}
              title={
                wrongCount === 0
                  ? 'Nenhum erro nesta sessão — revisa erros de sessões anteriores também'
                  : undefined
              }
            >
              Revisar Erros
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="lg"
            onClick={() =>
              isBankMode
                ? navigate('/app/banco')
                : examId
                  ? navigate(`/app/quiz/setup/${examId}`)
                  : navigate('/app')
            }
            disabled={!isBankMode && !examId}
          >
            Nova Simulação
          </Button>
          <Button variant="ghost" size="lg" onClick={() => window.print()}>
            Imprimir
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() =>
              isBankMode ? navigate('/app/banco') : navigate(examId ? `/app/exam/${examId}` : '/app')
            }
          >
            {isBankMode ? 'Voltar ao Banco' : 'Retornar ao Terminal'}
          </Button>
        </footer>
      </div>
    </section>
  );
}
