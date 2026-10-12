import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiFetch } from '../api/client';
import { fetchExam, fetchExamQuestions, type Question } from '../api/exams';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { TerminalTab } from '../components/ui/TerminalTab';
import { toast } from '../components/ui/ToastUtils';
import './ExamReviewPage.css';

type UpdateQuestionPayload = Partial<
  Pick<Question, 'questionText' | 'options' | 'subject' | 'correctAnswer'> & {
    contextText: string | null;
  }
>;

type ReviewFilter = 'all' | 'low-confidence' | 'no-answer' | 'has-image' | 'annulled';

const LOW_CONFIDENCE_THRESHOLD = 60;

const FILTERS: Array<{ id: ReviewFilter; label: string; match: (q: Question) => boolean }> = [
  { id: 'all', label: 'Todas', match: () => true },
  {
    id: 'low-confidence',
    label: '⚠ baixa confiança',
    match: (q) => typeof q.confidence === 'number' && q.confidence < LOW_CONFIDENCE_THRESHOLD,
  },
  {
    id: 'no-answer',
    label: '🔴 sem gabarito',
    match: (q) => !q.correctAnswer || q.correctAnswer.trim().length === 0,
  },
  {
    id: 'has-image',
    label: '📄 com imagem',
    match: (q) => Boolean(q.hasImage || q.requiresPdf),
  },
  { id: 'annulled', label: 'anuladas', match: (q) => Boolean(q.annulled) },
];

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

type ReviewQuestionCardProps = {
  examId: string;
  question: Question;
  onRequestDelete: (question: Question) => void;
};

/**
 * Card de edição inline com PATCH debounced (300ms) — acumula campos
 * alterados num único payload por flush. Indicador salvando…/salvo por card.
 */
function ReviewQuestionCard({ examId, question, onRequestDelete }: ReviewQuestionCardProps) {
  const [contextText, setContextText] = useState(question.contextText ?? '');
  const [questionText, setQuestionText] = useState(question.questionText);
  const [subject, setSubject] = useState(question.subject ?? '');
  const [correctAnswer, setCorrectAnswer] = useState(question.correctAnswer ?? '');
  const [options, setOptions] = useState<string[]>(question.options);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const pendingRef = useRef<UpdateQuestionPayload>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMutation = useMutation({
    mutationFn: (payload: UpdateQuestionPayload) =>
      apiFetch<{ success: boolean }>(`/exams/${examId}/questions/${question.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setSaveState('saved');
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2000);
    },
    onError: (error) => {
      setSaveState('error');
      toast(error instanceof Error ? error.message : 'Falha na recalibração.', 'error');
    },
  });

  const saveMutationRef = useRef(saveMutation);

  useEffect(() => {
    saveMutationRef.current = saveMutation;
  });

  // Flush pendente ao desmontar (evita perder a última edição ao trocar de filtro).
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (savedTimerRef.current) {
        clearTimeout(savedTimerRef.current);
      }
      if (Object.keys(pendingRef.current).length > 0) {
        const payload = pendingRef.current;
        pendingRef.current = {};
        saveMutationRef.current.mutate(payload);
      }
    };
  }, []);

  const scheduleSave = (patch: UpdateQuestionPayload) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    setSaveState((state) => (state === 'saving' ? 'saving' : 'pending'));

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      const payload = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(payload).length === 0) {
        return;
      }
      setSaveState('saving');
      saveMutation.mutate(payload);
    }, 300);
  };

  const saveIndicator =
    saveState === 'pending' || saveState === 'saving'
      ? 'salvando…'
      : saveState === 'saved'
        ? 'salvo ✓'
        : saveState === 'error'
          ? 'falha ao salvar'
          : '';

  return (
    <div className="cut--b exam-review__question-card">
      <div className="exam-review__question-header">
        <span className="exam-review__q-number">#{question.order}</span>
        {question.annulled ? (
          <span className="badge badge--warn badge--dashed exam-review__q-warning exam-review__q-warning--annulled">ANULADA</span>
        ) : null}
        {typeof question.confidence === 'number' && question.confidence < LOW_CONFIDENCE_THRESHOLD ? (
          <span className="badge badge--info badge--dashed exam-review__q-warning">Sinal Fraco: {Math.round(question.confidence)}%</span>
        ) : null}
        {question.hasImage || question.requiresPdf ? (
          <span className="badge badge--flare badge--dashed exam-review__q-warning exam-review__q-warning--image">📄 página</span>
        ) : null}
        <span
          className={`exam-review__save-indicator exam-review__save-indicator--${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveIndicator}
        </span>
      </div>

      <label className="field-label exam-review__label">Contexto Base</label>
      <textarea
        className="input input--terminal exam-review__textarea"
        value={contextText}
        placeholder="Ex: Leia o texto abaixo para responder à questão..."
        onChange={(event) => {
          setContextText(event.target.value);
          const trimmed = event.target.value.trim();
          scheduleSave({ contextText: trimmed.length > 0 ? trimmed : null });
        }}
      />

      <label className="field-label exam-review__label">Enunciado do Fragmento</label>
      <textarea
        className="input input--terminal exam-review__textarea exam-review__textarea--main"
        value={questionText}
        onChange={(event) => {
          setQuestionText(event.target.value);
          scheduleSave({ questionText: event.target.value });
        }}
      />

      <div className="exam-review__grid">
        <div className="exam-review__field-group">
          <label className="field-label exam-review__label">Setor (Disciplina)</label>
          <input
            className="input input--terminal exam-review__input"
            value={subject}
            placeholder="Ex: Matemática"
            onChange={(event) => {
              setSubject(event.target.value);
              scheduleSave({ subject: event.target.value });
            }}
          />
        </div>

        <div className="exam-review__field-group">
          <label className="field-label exam-review__label">Vetor Correto (Gabarito)</label>
          <select
            className="input input--terminal exam-review__input exam-review__select"
            value={correctAnswer}
            onChange={(event) => {
              setCorrectAnswer(event.target.value);
              scheduleSave({ correctAnswer: event.target.value });
            }}
          >
            <option value="">Indeterminado</option>
            {['A', 'B', 'C', 'D', 'E'].map((letter) => (
              <option key={letter} value={letter}>
                Vetor {letter}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="field-label exam-review__label">Variações (Alternativas)</label>
      <div className="exam-review__options">
        {options.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          const isCorrect = letter === correctAnswer;
          return (
            <div key={`${question.id}-${index}`} className="exam-review__option-row">
              <span
                className={`exam-review__option-letter ${isCorrect ? 'exam-review__option-letter--correct' : ''}`}
              >
                {letter}
              </span>
              <input
                className={`input input--terminal exam-review__input ${isCorrect ? 'exam-review__input--correct' : ''}`}
                value={option}
                onChange={(event) => {
                  const updated = [...options];
                  updated[index] = event.target.value;
                  setOptions(updated);
                  scheduleSave({ options: updated });
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="exam-review__question-footer">
        <Button variant="danger" size="sm" onClick={() => onRequestDelete(question)}>
          Dissipar
        </Button>
      </div>
    </div>
  );
}

export function ExamReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null);

  const examQuery = useQuery({
    queryKey: ['exam-review-detail', id],
    queryFn: () => fetchExam(id),
  });

  const questionsQuery = useQuery({
    queryKey: ['exam-review-questions', id],
    queryFn: () => fetchExamQuestions(id),
  });

  const publishMutation = useMutation({
    mutationFn: () => apiFetch<{ success: boolean; status: string }>(`/exams/${id}/publish`, { method: 'POST' }),
    onSuccess: () => {
      toast('Evento consolidado. Prova pronta.', 'success');
      navigate(`/app/exam/${id}`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Anomalia ao consolidar.', 'error');
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiFetch<{ success: boolean }>(`/exams/${id}/questions/${questionId}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast('Fragmento dissipado.', 'info');
      setDeleteTarget(null);
      await questionsQuery.refetch();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Erro ao dissipar fragmento.', 'error');
    },
  });

  const questions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);

  const filterCounts = useMemo(() => {
    const counts = {} as Record<ReviewFilter, number>;
    for (const entry of FILTERS) {
      counts[entry.id] = questions.filter(entry.match).length;
    }
    return counts;
  }, [questions]);

  const visibleQuestions = useMemo(() => {
    const active = FILTERS.find((entry) => entry.id === filter) ?? FILTERS[0];
    return questions.filter(active.match);
  }, [filter, questions]);

  if (examQuery.isLoading || questionsQuery.isLoading) {
    return (
      <section className="exam-review page page-container page--padded">
        <div className="terminal terminal--cut-b exam-review__terminal">
          <Skeleton width="45%" height="32px" />
          <Skeleton className="skeleton-gap exam-review__skeleton-gap" width="70%" height="16px" />
        </div>
      </section>
    );
  }

  if (examQuery.isError || questionsQuery.isError || !examQuery.data) {
    return (
      <section className="exam-review page page-container page--padded">
        <div className="terminal terminal--cut-b terminal--error exam-review__terminal exam-review__terminal--error">
          <p>Erro crítico ao carregar a interface de revisão.</p>
          <Button variant="ghost" onClick={() => void questionsQuery.refetch()}>
            Tentar reconexão
          </Button>
        </div>
      </section>
    );
  }

  const exam = examQuery.data;
  const isPublished = exam.status === 'completed';

  return (
    <section className="exam-review page page-container page--padded">
      <div className="exam-review__container">
        {/* Protruding Status Badge */}
        <TerminalTab
          label={isPublished ? 'Consolidado' : 'Em Rascunho'}
          variant={isPublished ? 'completed' : 'reviewing'}
        />

        <div className="terminal terminal--cut-b exam-review__terminal">
          <div className="premium-glow exam-review__premium-glow" />

          <header className="terminal__header exam-review__header">
            <div className="exam-review__header-content">
              <h1 className="page-title exam-review__title">Inspeção de Fragmentos</h1>
              <p className="page-subtitle exam-review__subtitle">SYS.ID // {exam.title}</p>
              {isPublished && (
                <div className="callout callout--warn exam-review__published-hint">
                  <span className="exam-review__hint-icon">⚠</span>
                  Alerta: Modificações feitas aqui alterarão diretamente a malha da prova publicada.
                </div>
              )}
            </div>

            <div className="exam-review__header-actions">
              <Button variant="ghost" onClick={() => navigate(`/app/exam/${id}`)}>
                Abortar
              </Button>
              {!isPublished && (
                <Button onClick={() => publishMutation.mutate()} loading={publishMutation.isPending}>
                  Consolidar Evento
                </Button>
              )}
            </div>
          </header>
        </div>
      </div>

      <div className="exam-review__filters" role="tablist" aria-label="Filtros de fragmentos">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={filter === entry.id}
            className={`exam-review__filter-chip ${filter === entry.id ? 'exam-review__filter-chip--active' : ''}`}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
            <span className="exam-review__filter-count">{filterCounts[entry.id]}</span>
          </button>
        ))}
      </div>

      <div className="exam-review__list">
        {visibleQuestions.length === 0 ? (
          <p className="empty empty--boxed exam-review__empty">Nenhum fragmento corresponde a este filtro.</p>
        ) : (
          visibleQuestions.map((question) => (
            <ReviewQuestionCard
              key={question.id}
              examId={id}
              question={question}
              onRequestDelete={setDeleteTarget}
            />
          ))
        )}
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Dissipar fragmento?"
        description={
          deleteTarget
            ? `A questão #${deleteTarget.order} será removida permanentemente da malha da prova.`
            : undefined
        }
      >
        <div className="exam-review__modal-actions">
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteTarget && deleteQuestionMutation.mutate(deleteTarget.id)}
            loading={deleteQuestionMutation.isPending}
          >
            Dissipar definitivamente
          </Button>
        </div>
      </Modal>
    </section>
  );
}
