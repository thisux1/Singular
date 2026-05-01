import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { apiFetch } from '../api/client';
import { fetchExam, fetchExamQuestions, type Question } from '../api/exams';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { TerminalTab } from '../components/ui/TerminalTab';
import { toast } from '../components/ui/ToastUtils';
import './ExamReviewPage.css';

type UpdateQuestionPayload = Partial<
  Pick<Question, 'questionText' | 'options' | 'subject' | 'correctAnswer' | 'contextText'>
>;

export function ExamReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

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
      navigate(`/exam/${id}`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Anomalia ao consolidar.', 'error');
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: ({ questionId, payload }: { questionId: string; payload: UpdateQuestionPayload }) =>
      apiFetch<{ success: boolean }>(`/exams/${id}/questions/${questionId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      toast('Fragmento recalibrado.', 'success');
      await questionsQuery.refetch();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha na recalibração.', 'error');
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: (questionId: string) =>
      apiFetch<{ success: boolean }>(`/exams/${id}/questions/${questionId}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      toast('Fragmento dissipado.', 'info');
      await questionsQuery.refetch();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Erro ao dissipar fragmento.', 'error');
    },
  });

  if (examQuery.isLoading || questionsQuery.isLoading) {
    return (
      <section className="exam-review page page-container">
        <div className="exam-review__terminal">
          <Skeleton width="45%" height="32px" />
          <Skeleton className="exam-review__skeleton-gap" width="70%" height="16px" />
        </div>
      </section>
    );
  }

  if (examQuery.isError || questionsQuery.isError || !examQuery.data) {
    return (
      <section className="exam-review page page-container">
        <div className="exam-review__terminal exam-review__terminal--error">
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
    <section className="exam-review page page-container">
      <div className="exam-review__container">
        {/* Protruding Status Badge */}
        <TerminalTab 
          label={isPublished ? 'Consolidado' : 'Em Rascunho'} 
          variant={isPublished ? 'completed' : 'reviewing'} 
        />

        <div className="exam-review__terminal">
          <div className="exam-review__premium-glow" />

        <header className="exam-review__header">
          <div className="exam-review__header-content">
            <h1 className="exam-review__title">Inspeção de Fragmentos</h1>
            <p className="exam-review__subtitle">SYS.ID // {exam.title}</p>
            {isPublished && (
              <div className="exam-review__published-hint">
                <span className="exam-review__hint-icon">⚠</span>
                Alerta: Modificações feitas aqui alterarão diretamente a malha da prova publicada.
              </div>
            )}
          </div>
          
          <div className="exam-review__header-actions">
            <Button variant="ghost" onClick={() => navigate(`/exam/${id}`)}>
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

      <div className="exam-review__list">
        {questionsQuery.data?.map((question) => (
          <div key={question.id} className="exam-review__question-card">
            <div className="exam-review__question-header">
              <span className="exam-review__q-number">#{question.order}</span>
              {typeof question.confidence === 'number' && question.confidence < 80 ? (
                <span className="exam-review__q-warning">
                  Sinal Fraco: {Math.round(question.confidence)}%
                </span>
              ) : null}
            </div>

              <label className="exam-review__label">Contexto Base</label>
              <textarea
                className="exam-review__textarea"
                defaultValue={question.contextText ?? ''}
                placeholder="Ex: Leia o texto abaixo para responder à questão..."
                onBlur={(event) => {
                  const newValue = event.target.value.trim();
                  const currentValue = question.contextText ?? '';
                  if (newValue !== currentValue) {
                    updateQuestionMutation.mutate({
                      questionId: question.id,
                      payload: { contextText: newValue || null },
                    });
                  }
                }}
              />

              <label className="exam-review__label">Enunciado do Fragmento</label>
              <textarea
                className="exam-review__textarea exam-review__textarea--main"
                defaultValue={question.questionText}
                onBlur={(event) => {
                  if (event.target.value !== question.questionText) {
                    updateQuestionMutation.mutate({
                      questionId: question.id,
                      payload: { questionText: event.target.value },
                    });
                  }
                }}
              />

              <div className="exam-review__grid">
                <div className="exam-review__field-group">
                  <label className="exam-review__label">Setor (Disciplina)</label>
                  <input
                    className="exam-review__input"
                    defaultValue={question.subject ?? ''}
                    placeholder="Ex: Matemática"
                    onBlur={(event) => {
                      if (event.target.value !== (question.subject ?? '')) {
                        updateQuestionMutation.mutate({
                          questionId: question.id,
                          payload: { subject: event.target.value },
                        });
                      }
                    }}
                  />
                </div>

                <div className="exam-review__field-group">
                  <label className="exam-review__label">Vetor Correto (Gabarito)</label>
                  <select
                    className="exam-review__input exam-review__select"
                    defaultValue={question.correctAnswer ?? ''}
                    onChange={(event) => {
                      if (event.target.value !== (question.correctAnswer ?? '')) {
                        updateQuestionMutation.mutate({
                          questionId: question.id,
                          payload: { correctAnswer: event.target.value },
                        });
                      }
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

              <label className="exam-review__label">Variações (Alternativas)</label>
              <div className="exam-review__options">
                {question.options.map((option, index) => {
                  const letter = String.fromCharCode(65 + index);
                  const isCorrect = letter === question.correctAnswer;
                  return (
                    <div key={`${question.id}-${index}`} className="exam-review__option-row">
                      <span className={`exam-review__option-letter ${isCorrect ? 'exam-review__option-letter--correct' : ''}`}>
                        {letter}
                      </span>
                      <input
                        className={`exam-review__input ${isCorrect ? 'exam-review__input--correct' : ''}`}
                        defaultValue={option}
                        onBlur={(event) => {
                          if (event.target.value !== option) {
                            const updated = [...question.options];
                            updated[index] = event.target.value;

                            updateQuestionMutation.mutate({
                              questionId: question.id,
                              payload: { options: updated },
                            });
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="exam-review__question-footer">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    const confirmed = window.confirm('Deletar este fragmento causará perda permanente de dados. Prosseguir?');
                    if (confirmed) {
                      deleteQuestionMutation.mutate(question.id);
                    }
                  }}
                >
                  Dissipar
                </Button>
              </div>
            </div>
          ))}
        </div>
    </section>
  );
}
