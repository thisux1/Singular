import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type ChangeEventHandler, type FormEventHandler } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { fetchCargoTemplates, fetchExams, uploadExam } from '../api/exams';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import { GravitationalCard } from '../components/effects/GravitationalCard';
import { ExamSingularityCard } from '../components/effects/ExamSingularityCard';
import { AnimatedFileIcon } from '../components/ui/AnimatedIcons';
import './ExamListPage.css';

function getStatusDisplay(status: string) {
  if (status === 'queued') return { label: 'Em órbita: Aguardando fila' };
  if (status === 'processing') return { label: 'Extraindo dados da singularidade...' };
  if (status === 'reviewing') return { label: 'Anomalia detectada: Requer revisão manual' };
  if (status === 'failed') return { label: 'Falha crítica: Estrutura corrompida' };
  return { label: null }; // Clean state, no text.
}

export function ExamListPage() {
  const navigate = useNavigate();
  const provaFileInputRef = useRef<HTMLInputElement>(null);
  const gabaritoFileInputRef = useRef<HTMLInputElement>(null);

  const [provaFile, setProvaFile] = useState<File | null>(null);
  const [gabaritoFile, setGabaritoFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [edital, setEdital] = useState('');
  const [examDate, setExamDate] = useState('');
  const [provaType, setProvaType] = useState('');
  const [cargoTemplateId, setCargoTemplateId] = useState('');
  const [pageStart, setPageStart] = useState('');
  const [pageEnd, setPageEnd] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const examsQuery = useQuery({
    queryKey: ['exams'],
    queryFn: fetchExams,
  });

  const cargoTemplatesQuery = useQuery({
    queryKey: ['cargo-templates'],
    queryFn: fetchCargoTemplates,
  });

  const uploadMutation = useMutation({
    mutationFn: uploadExam,
    onSuccess: (data) => {
      setProvaFile(null);
      setGabaritoFile(null);
      setTitle('');
      setEdital('');
      setExamDate('');
      setProvaType('');
      setCargoTemplateId('');
      setPageStart('');
      setPageEnd('');
      setRangeError(null);

      if (provaFileInputRef.current) {
        provaFileInputRef.current.value = '';
      }

      if (gabaritoFileInputRef.current) {
        gabaritoFileInputRef.current.value = '';
      }

      navigate(`/exam/${data.exam_id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast(error.message, 'error');
        return;
      }
      toast('Erro de rede ao enviar prova.', 'error');
    },
  });

  const onChangeProvaFile: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0] ?? null;
    setProvaFile(file);
  };

  const onChangeGabaritoFile: ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0] ?? null;
    setGabaritoFile(file);
  };

  const onSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();

    if (!provaFile) {
      toast('Selecione o arquivo da prova para enviar.', 'error');
      return;
    }

    const parsedPageStart = pageStart.trim().length > 0 ? Number.parseInt(pageStart, 10) : undefined;
    const parsedPageEnd = pageEnd.trim().length > 0 ? Number.parseInt(pageEnd, 10) : undefined;

    if (
      parsedPageStart !== undefined
      && parsedPageEnd !== undefined
      && parsedPageEnd < parsedPageStart
    ) {
      const message = 'pageEnd deve ser maior ou igual a pageStart.';
      setRangeError(message);
      toast(message, 'error');
      return;
    }

    setRangeError(null);

    uploadMutation.mutate({
      file: provaFile,
      gabaritoFile: gabaritoFile ?? undefined,
      title: title.trim() || undefined,
      edital: edital.trim() || undefined,
      examDate: examDate.trim() || undefined,
      provaType: provaType.trim().toUpperCase() || undefined,
      cargoTemplateId: cargoTemplateId || undefined,
      pageStart: parsedPageStart,
      pageEnd: parsedPageEnd,
    });
  };

  const isSubmitting = uploadMutation.isPending;

  const pageRangeHint =
    rangeError ?? 'Faixa opcional para ignorar capa/anexos.';

  const pageRangeClassName = rangeError ? 'exam-list__hint exam-list__error' : 'exam-list__hint';

  const acceptTypes = '.pdf,image/png,image/jpeg,image/webp,image/jpg';

  const selectedProvaLabel = provaFile ? provaFile.name : 'Selecione o arquivo...';
  const selectedGabaritoLabel = gabaritoFile ? gabaritoFile.name : 'Selecione o arquivo...';

  const isCargoLoading = cargoTemplatesQuery.isLoading;
  const cargoTemplates = cargoTemplatesQuery.data ?? [];

  const retryCargoTemplates = () => {
    void cargoTemplatesQuery.refetch();
  };

  return (
    <section className="exam-list page page-container">
      <div className="exam-list__hero">
        <h1 className="exam-list__hero-title">Terminal de Provas</h1>
        <p className="exam-list__hero-subtitle">
          Condense o espaço-tempo de seus estudos. Envie provas e gabaritos para extrair conhecimento absoluto através da singularidade.
        </p>
      </div>

      <div className="exam-list__terminal">
        <div className="exam-list__premium-glow" />
        <form className="exam-list__ingest-form" onSubmit={onSubmit}>
          <div className="exam-list__ingest-grid">
            <div className="exam-list__field exam-list__field--file">
              <label className="exam-list__label" htmlFor="exam-upload-file">
                Arquivo Base (Obrigatório)
              </label>
              <div className="exam-list__file-box" onClick={() => provaFileInputRef.current?.click()}>
                <AnimatedFileIcon selected={!!provaFile} type="base" />
                <span className="exam-list__file-name">{selectedProvaLabel}</span>
                <input
                  ref={provaFileInputRef}
                  id="exam-upload-file"
                  className="exam-list__file-input"
                  type="file"
                  accept={acceptTypes}
                  onChange={onChangeProvaFile}
                />
              </div>
            </div>

            <div className="exam-list__field exam-list__field--file">
              <label className="exam-list__label" htmlFor="exam-upload-gabarito">
                Gabarito Oficial (Opcional)
              </label>
              <div className="exam-list__file-box" onClick={() => gabaritoFileInputRef.current?.click()}>
                <AnimatedFileIcon selected={!!gabaritoFile} type="check" />
                <span className="exam-list__file-name">{selectedGabaritoLabel}</span>
                <input
                  ref={gabaritoFileInputRef}
                  id="exam-upload-gabarito"
                  className="exam-list__file-input"
                  type="file"
                  accept={acceptTypes}
                  onChange={onChangeGabaritoFile}
                />
              </div>
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-title">Identificação / Título</label>
              <input
                id="exam-title"
                className="exam-list__input"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex: Simulado Banco do Brasil"
              />
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-edital">Referência do Edital</label>
              <input
                id="exam-edital"
                className="exam-list__input"
                type="text"
                value={edital}
                onChange={(event) => setEdital(event.target.value)}
                placeholder="Ex: Edital 01/2026"
              />
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-date">Data Temporal da Prova</label>
              <input
                id="exam-date"
                className="exam-list__input"
                type="date"
                value={examDate}
                onChange={(event) => setExamDate(event.target.value)}
              />
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-prova-type">Arquétipo / Tipo</label>
              <input
                id="exam-prova-type"
                className="exam-list__input"
                type="text"
                value={provaType}
                onChange={(event) => setProvaType(event.target.value)}
                placeholder="Ex: Objetiva"
              />
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-cargo-template">Mapeamento de Cargo</label>
              <select
                id="exam-cargo-template"
                className="exam-list__input"
                value={cargoTemplateId}
                onChange={(event) => setCargoTemplateId(event.target.value)}
                disabled={isCargoLoading}
              >
                <option value="">{isCargoLoading ? 'Carregando templates...' : 'Nenhum selecionado (Opcional)'}</option>
                {cargoTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label} • {template.banca} • {template.totalQuestions}Q
                  </option>
                ))}
              </select>
              {cargoTemplatesQuery.isError && (
                <div className="exam-list__actions">
                  <span className="exam-list__error">Falha ao acessar os arquétipos.</span>
                  <Button type="button" variant="ghost" size="sm" onClick={retryCargoTemplates}>
                    Reconectar
                  </Button>
                </div>
              )}
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-page-start">Limitar Extração (Início)</label>
              <input
                id="exam-page-start"
                className="exam-list__input"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={pageStart}
                onChange={(event) => setPageStart(event.target.value)}
                placeholder="Página Ex: 3"
              />
            </div>

            <div className="exam-list__field">
              <label className="exam-list__label" htmlFor="exam-page-end">Limitar Extração (Fim)</label>
              <input
                id="exam-page-end"
                className="exam-list__input"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={pageEnd}
                onChange={(event) => setPageEnd(event.target.value)}
                placeholder="Página Ex: 28"
              />
              <span className={pageRangeClassName}>{pageRangeHint}</span>
            </div>
          </div>

          <div className="exam-list__form-footer">
            <Button type="submit" size="lg" loading={isSubmitting}>
              {isSubmitting ? 'Iniciando Compressão...' : 'Enviar Dados à Singularidade'}
            </Button>
          </div>
        </form>
      </div>

      <div className="exam-list__grid-section">
        <h2 className="exam-list__section-title">Dados Extraídos</h2>
        
        {examsQuery.isLoading && (
          <div className="exam-grid">
            {Array.from({ length: 3 }, (_, index) => (
              <Card key={index} className="exam-list__card exam-list__card--loading">
                <Skeleton height="28px" width="50%" />
                <Skeleton className="exam-list__skeleton-gap" height="16px" width="30%" />
              </Card>
            ))}
          </div>
        )}

        {examsQuery.isError && (
          <div className="exam-list__premium-card exam-list__premium-card--error">
            <p>Ruptura de rede ao carregar os dados. A conexão falhou.</p>
            <Button variant="ghost" onClick={() => void examsQuery.refetch()}>
              Tentar reconexão
            </Button>
          </div>
        )}

        {examsQuery.data && examsQuery.data.length === 0 && (
          <div className="exam-list__empty-state">
            <div className="exam-list__empty-icon">∅</div>
            <p>O vazio. Nenhuma prova encontrada. Inicie enviando os dados acima.</p>
          </div>
        )}

        {examsQuery.data && examsQuery.data.length > 0 && (
          <div className="exam-grid">
            {examsQuery.data.map((exam) => {
              const statusDisplay = getStatusDisplay(exam.status);
              
              return (
                <ExamSingularityCard
                  key={exam.id}
                  status={exam.status}
                  onClick={() => navigate(`/exam/${exam.id}`)}
                >
                  <p className="exam-list__title">{exam.title}</p>
                  <p className="exam-list__id-label">{exam.id}</p>
                  {statusDisplay.label && (
                    <div className="exam-list__status-msg">
                      {statusDisplay.label}
                    </div>
                  )}
                </ExamSingularityCard>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: '100px', display: 'flex', justifyContent: 'center', marginBottom: '80px' }}>
        <GravitationalCard />
      </div>
    </section>
  );
}
