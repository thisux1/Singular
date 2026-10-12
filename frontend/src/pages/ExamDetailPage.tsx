import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import {
  deleteExam,
  fetchExam,
  fetchExamProgress,
  fetchExamQuestions,
  publishExam,
  reprocessExam,
} from '../api/exams';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { TerminalTab, type TerminalTabVariant } from '../components/ui/TerminalTab';
import { toast } from '../components/ui/ToastUtils';
import './ExamDetailPage.css';

function statusVariantClass(status: string): TerminalTabVariant {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'reviewing') return 'reviewing';
  return 'processing';
}

function statusLabel(status: string): string {
  if (status === 'queued') return 'Na fila';
  if (status === 'processing') return 'Processando';
  if (status === 'reviewing') return 'Em revisão';
  if (status === 'completed') return 'Publicado';
  return 'Falhou';
}

const STAGE_LABELS: Record<string, string> = {
  extracting: 'Extraindo texto',
  structuring: 'Estruturando questões',
  persisting: 'Persistindo fragmentos',
  classifying: 'Classificando disciplinas',
};

function stageLabel(stage: string | undefined): string {
  if (!stage) {
    return 'Processando';
  }
  return STAGE_LABELS[stage] ?? stage;
}

function extractApiErrorMetadata(error: ApiError): { code: string | null; errorMessage: string | null } {
  if (typeof error.data !== 'object' || error.data === null || !('error' in error.data)) {
    return { code: null, errorMessage: null };
  }

  const payload = (error.data as { error?: unknown }).error;

  if (typeof payload !== 'object' || payload === null) {
    return { code: null, errorMessage: null };
  }

  const code = (payload as { code?: unknown }).code;
  const errorMessage = (payload as { error_message?: unknown }).error_message;

  return {
    code: typeof code === 'string' ? code : null,
    errorMessage: typeof errorMessage === 'string' && errorMessage.trim().length > 0 ? errorMessage : null,
  };
}

function statusHint(status: string, examErrorMessage: string | null): string {
  if (status === 'queued' || status === 'processing') {
    return 'A singularidade ainda está condensando os dados. Aguarde a extração.';
  }

  if (status === 'failed') {
    return examErrorMessage
      ? `Falha catastrófica no evento. Detalhe: ${examErrorMessage}`
      : 'Ruptura nos dados. Verifique a estrutura do arquivo enviado.';
  }

  if (status === 'completed') {
    return 'Evento consolidado. Você pode revisar o conhecimento ou entrar na simulação diretamente.';
  }

  return 'Dados extraídos com sucesso. Análise manual recomendada antes da publicação.';
}

/** parsingLog é JSON arbitrário do pipeline — render legível e colapsável. */
function ParsingLogDetails({ log }: { log: unknown }) {
  if (log === null || log === undefined) {
    return null;
  }

  let pretty: string;
  try {
    pretty = JSON.stringify(log, null, 2);
  } catch {
    pretty = String(log);
  }

  return (
    <details className="exam-detail__parsing-log">
      <summary>Log do pipeline</summary>
      <pre>{pretty}</pre>
    </details>
  );
}

export function ExamDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const examQuery = useQuery({
    queryKey: ['exam', id],
    queryFn: () => fetchExam(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'processing' ? 2000 : false;
    },
  });

  // Progress real do job (stage/percent/páginas) — mesmo intervalo do status.
  const progressQuery = useQuery({
    queryKey: ['exam-progress', id],
    queryFn: () => fetchExamProgress(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status ?? examQuery.data?.status;
      return status === 'queued' || status === 'processing' ? 2000 : false;
    },
  });

  const questionsQuery = useQuery({
    queryKey: ['exam-questions', id],
    queryFn: () => fetchExamQuestions(id),
    enabled: examQuery.data?.status === 'reviewing' || examQuery.data?.status === 'completed',
    retry: false,
  });

  const publishMutation = useMutation({
    mutationFn: () => publishExam(id),
    onSuccess: async () => {
      toast('Conhecimento publicado no nexo.', 'success');
      await examQuery.refetch();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha na publicação.', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteExam(id),
    onSuccess: () => {
      toast('Dados dissipados do núcleo.', 'info');
      navigate('/app');
    },
    onError: (error) => {
      setDeleteModalOpen(false);
      toast(error instanceof Error ? error.message : 'Falha ao dissipar dados.', 'error');
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessExam(id),
    onSuccess: async () => {
      toast('Processamento reiniciado.', 'success');
      await Promise.all([examQuery.refetch(), progressQuery.refetch()]);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha ao reprocessar.', 'error');
    },
  });

  if (examQuery.isLoading) {
    return (
      <section className="exam-detail page page-container">
        <div className="exam-detail__terminal">
          <Skeleton width="50%" height="32px" />
          <Skeleton className="exam-detail__skeleton-gap" width="80%" height="16px" />
        </div>
      </section>
    );
  }

  if (examQuery.isError || !examQuery.data) {
    return (
      <section className="exam-detail page page-container">
        <div className="exam-detail__terminal exam-detail__terminal--error">
          <p>Erro ao acessar a singularidade: {examQuery.error instanceof Error ? examQuery.error.message : 'Desconhecido'}</p>
          <Button variant="ghost" onClick={() => void examQuery.refetch()}>
            Tentar reconexão
          </Button>
        </div>
      </section>
    );
  }

  const exam = examQuery.data;
  const canStartQuiz = exam.status === 'completed';
  const canReviewQuestions = exam.status === 'reviewing' || exam.status === 'completed';
  const isProcessing = exam.status === 'queued' || exam.status === 'processing';
  const questions = questionsQuery.data ?? [];
  const questionCount = exam.totalQuestions ?? questions.length;

  const progress = progressQuery.data;
  const progressPercent = progress?.percent ?? (exam.status === 'reviewing' || exam.status === 'completed' ? 100 : 0);
  const hasPageProgress =
    progress?.pageCurrent !== undefined && progress?.pageTotal !== undefined && progress.pageTotal > 0;

  let questionsErrorMessage: string | null = null;

  if (questionsQuery.isError) {
    if (questionsQuery.error instanceof ApiError) {
      const { code, errorMessage } = extractApiErrorMetadata(questionsQuery.error);
      if (code === 'EXAM_FAILED') {
        questionsErrorMessage = errorMessage
          ? `Não é possível revisar uma prova com falha estrutural. Motivo: ${errorMessage}`
          : 'Falha no processamento. Dados irrecuperáveis.';
      } else {
        questionsErrorMessage = errorMessage
          ? `Anomalia nos dados: ${errorMessage}`
          : `Anomalia nos dados: ${questionsQuery.error.message}`;
      }
    } else {
      questionsErrorMessage = 'Não foi possível extrair a matéria neste nível de gravidade.';
    }
  }

  return (
    <section className="exam-detail page page-container">
      <div className="exam-detail__container">
        {/* Protruding Status Badge */}
        <TerminalTab 
          label={statusLabel(exam.status)} 
          variant={statusVariantClass(exam.status)} 
        />

        <div className="exam-detail__terminal">
          <div className="exam-detail__premium-glow" />
          
          {/* Header Section */}
        <header className="exam-detail__header">
          <h1 className="exam-detail__title">{exam.title}</h1>
          <p className="exam-detail__subtitle text-mono">SYS.ID // {exam.id}</p>
        </header>

        {/* Integrated Data Grid */}
        <div className="exam-detail__data-grid">
          <div className="exam-detail__data-box">
            <span className="exam-detail__data-label">Massa (Questões)</span>
            <strong className="exam-detail__data-value">{questionCount}</strong>
          </div>
          <div className="exam-detail__data-box">
            <span className="exam-detail__data-label">Densidade Atual</span>
            <strong className={`exam-detail__data-value exam-detail__${statusVariantClass(exam.status)}-text`}>
              {statusLabel(exam.status)}
            </strong>
          </div>
        </div>

        <div className="exam-detail__content">
          {isProcessing ? (
            <div className="exam-detail__progress" role="status" aria-live="polite">
              <div className="exam-detail__progress-meta">
                <span className="exam-detail__progress-stage">
                  {stageLabel(progress?.stage)}
                  {hasPageProgress ? ` · página ${progress.pageCurrent} de ${progress.pageTotal}` : ''}
                </span>
                <span className="exam-detail__progress-percent">{progressPercent}%</span>
              </div>
              <div className="exam-detail__progress-track">
                <div
                  className="exam-detail__progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="exam-detail__hint exam-detail__hint--progress">{statusHint(exam.status, null)}</p>
            </div>
          ) : (
            <p className={`exam-detail__hint ${exam.status === 'failed' ? 'exam-detail__hint--error' : ''}`}>
              {statusHint(exam.status, exam.errorMessage)}
            </p>
          )}

          {exam.status === 'failed' ? (
            <div className="exam-detail__error-box">
              <span className="exam-detail__error-icon">⚠</span>
              <div className="exam-detail__error-body">
                <p>{progress?.error ?? exam.errorMessage ?? 'Motivo desconhecido.'}</p>
                <ParsingLogDetails log={exam.parsingLog} />
              </div>
            </div>
          ) : null}

          {canReviewQuestions && questionsQuery.isLoading ? (
            <div className="exam-detail__questions-loading">
              <Skeleton width="100%" height="18px" />
              <Skeleton width="90%" height="18px" />
            </div>
          ) : null}

          {questionsErrorMessage ? (
            <div className="exam-detail__error-box">
              <span className="exam-detail__error-icon">⚠</span>
              <p>{questionsErrorMessage}</p>
            </div>
          ) : null}

          {!questionsQuery.isLoading && !questionsQuery.isError && canReviewQuestions && questions.length === 0 ? (
            <p className="exam-detail__hint">O vazio. Nenhum fragmento detectado.</p>
          ) : null}
        </div>

        {/* Footer Actions (Integrated) */}
        <footer className="exam-detail__footer">
          <Button
            variant="ghost"
            onClick={() => navigate(`/app/exam/${id}/review`)}
            disabled={!canReviewQuestions}
          >
            Inspecionar Fragmentos
          </Button>

          <Button
            variant={canStartQuiz ? "primary" : "ghost"}
            onClick={() => navigate(`/app/quiz/setup/${id}`)}
            disabled={!canStartQuiz}
          >
            Iniciar Simulação
          </Button>

          <Button
            variant={exam.status === 'reviewing' ? "primary" : "ghost"}
            onClick={() => publishMutation.mutate()}
            loading={publishMutation.isPending}
            disabled={exam.status !== 'reviewing'}
          >
            Consolidar Evento
          </Button>

          {exam.status === 'failed' && (
            <Button
              variant="primary"
              onClick={() => reprocessMutation.mutate()}
              loading={reprocessMutation.isPending}
            >
              Reprocessar
            </Button>
          )}

          <div className="exam-detail__footer-spacer" />

          <Button
            variant="danger"
            onClick={() => setDeleteModalOpen(true)}
            loading={deleteMutation.isPending}
          >
            Dissipar
          </Button>
        </footer>
      </div>
      </div>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Dissipar prova?"
        description="A dissipação de dados é permanente — a prova, seus fragmentos e o histórico de simulações serão removidos."
      >
        <div className="exam-detail__modal-actions">
          <Button variant="ghost" onClick={() => setDeleteModalOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            Dissipar definitivamente
          </Button>
        </div>
      </Modal>
    </section>
  );
}
