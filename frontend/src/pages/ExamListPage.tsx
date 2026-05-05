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
import { FlipDrawerGallery } from '../components/effects/FlipDrawerGallery';
import { AnimatedFileIcon } from '../components/ui/AnimatedIcons';
import { FuiSelect } from '../components/ui/FuiSelect';
import { motion, AnimatePresence } from 'framer-motion';
import './ExamListPage.css';


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
  
  const [step, setStep] = useState(1);
  const handleNext = () => setStep(s => Math.min(3, s + 1));
  const handlePrev = () => setStep(s => Math.max(1, s - 1));

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

  const handleDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    let val = event.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    
    if (val.length > 4) {
      val = `${val.slice(0, 2)}/${val.slice(2, 4)}/${val.slice(4)}`;
    } else if (val.length > 2) {
      val = `${val.slice(0, 2)}/${val.slice(2)}`;
    }
    
    setExamDate(val);
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

    let isoDate: string | undefined = undefined;
    if (examDate.trim().length === 10) {
      const [day, month, year] = examDate.split('/');
      isoDate = `${year}-${month}-${day}`;
    }

    uploadMutation.mutate({
      file: provaFile,
      gabaritoFile: gabaritoFile ?? undefined,
      title: title.trim() || undefined,
      edital: edital.trim() || undefined,
      examDate: isoDate || examDate.trim() || undefined,
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

  let isoDatePreview: string | undefined = undefined;
  if (examDate.trim().length === 10) {
    const [day, month, year] = examDate.split('/');
    isoDatePreview = `${year}-${month}-${day}`;
  }

  const previewExam: any = {
    id: 'PROV-XX-000',
    title: title || 'INSERIR TÍTULO',
    status: isSubmitting ? 'processing' : 'queued',
    totalQuestions: null,
    errorMessage: null,
    pageOffset: null,
    edital: edital || 'INSERIR EDITAL',
    examDate: isoDatePreview || examDate || null,
    cargoTemplateId: cargoTemplateId || null,
  };

  const logs = [];
  if (provaFile) logs.push(`> [FILE] ${provaFile.name} (VALID)`);
  if (gabaritoFile) logs.push(`> [GAB] ${gabaritoFile.name} (VALID)`);
  if (title) logs.push(`> [TITLE] ${title}`);
  if (edital) logs.push(`> [REF] ${edital}`);
  if (cargoTemplateId) logs.push(`> [MAPPING] Linked to template ${cargoTemplateId}`);
  if (step === 1 && !provaFile) logs.push(`> Awaiting Primary Files...`);
  if (step === 2 && !title) logs.push(`> Awaiting Identification Metadata...`);
  if (step === 3) logs.push(`> Awaiting Extraction Parameters...`);
  if (isSubmitting) logs.push(`> INITIATING COMPRESSION...`);

  const renderLogs = (className: string) => (
    <div className={`exam-list__live-logs ${className}`}>
      <div className="live-logs-header">TERMINAL LOG OUTPUT</div>
      <div className="live-logs-body">
        {logs.map((log, index) => (
          <div key={index} className="log-line">{log}</div>
        ))}
        <div className="log-line log-cursor">█</div>
      </div>
    </div>
  );

  return (
    <section className="exam-list page page-container">
      <div className="exam-list__hero">
        <h1 className="exam-list__hero-title">Terminal de Provas</h1>
        <p className="exam-list__hero-subtitle">
          Condense o espaço-tempo de seus estudos. Envie provas e gabaritos para extrair conhecimento absoluto através da singularidade.
        </p>
      </div>

      {renderLogs('exam-list__live-logs--top')}

      <div className="exam-list__dual-terminal">
        {/* WIZARD LEFT SIDE */}
        <div className="exam-list__wizard">
          <div className="exam-list__wizard-header">
            <div className="exam-list__led-indicator">
              <div className="led-track">
                <div className={`led ${step >= 1 ? 'led--active' : ''}`} />
                <div className="led-line" />
                <div className={`led ${step >= 2 ? 'led--active' : ''}`} />
                <div className="led-line" />
                <div className={`led ${step >= 3 ? 'led--active' : ''}`} />
              </div>
              <span className="led-label">ESTÁGIO {step}/3</span>
            </div>
            <h2 className="exam-list__wizard-title">
              {step === 1 ? 'Arquivos Primários' : step === 2 ? 'Identificação' : 'Parâmetros Técnicos'}
            </h2>
          </div>

          <form className="exam-list__ingest-form" onSubmit={onSubmit}>
            <div className="exam-list__ingest-grid exam-list__ingest-grid--single">
              <AnimatePresence mode="wait">
                {/* STEP 1: ARQUIVOS */}
                {step === 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, y: 15, filter: 'blur(4px) hue-rotate(90deg)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px) hue-rotate(0deg)' }}
                    exit={{ opacity: 0, y: -15, filter: 'blur(4px) hue-rotate(-90deg)' }}
                    transition={{ duration: 0.3 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
                  >
                    <div className={`exam-list__field exam-list__field--file ${provaFile ? 'is-active' : ''}`}>
                      <label className="exam-list__label" htmlFor="exam-upload-file">
                        Arquivo Base (Obrigatório)
                      </label>
                      <div className="exam-list__file-box" onClick={() => provaFileInputRef.current?.click()}>
                        <div className={`led ${provaFile ? 'led--active' : ''}`} />
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

                    <div className={`exam-list__field exam-list__field--file ${gabaritoFile ? 'is-active' : ''}`}>
                      <label className="exam-list__label" htmlFor="exam-upload-gabarito">
                        Gabarito Oficial (Opcional)
                      </label>
                      <div className="exam-list__file-box" onClick={() => gabaritoFileInputRef.current?.click()}>
                        <div className={`led ${gabaritoFile ? 'led--active' : ''}`} />
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
                  </motion.div>
                )}

                {/* STEP 2: IDENTIFICAÇÃO */}
                {step === 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, y: 15, filter: 'blur(4px) hue-rotate(90deg)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px) hue-rotate(0deg)' }}
                    exit={{ opacity: 0, y: -15, filter: 'blur(4px) hue-rotate(-90deg)' }}
                    transition={{ duration: 0.3 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
                  >
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
                      type="text"
                      value={examDate}
                      onChange={handleDateChange}
                      placeholder="DD/MM/AAAA"
                      maxLength={10}
                    />
                  </div>
                  </motion.div>
                )}

                {/* STEP 3: EXTRAÇÃO E METADADOS TECNICOS */}
                {step === 3 && (
                  <motion.div
                    key="step3"
                    initial={{ opacity: 0, y: 15, filter: 'blur(4px) hue-rotate(90deg)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px) hue-rotate(0deg)' }}
                    exit={{ opacity: 0, y: -15, filter: 'blur(4px) hue-rotate(-90deg)' }}
                    transition={{ duration: 0.3 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
                  >
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
                    <FuiSelect
                      id="exam-cargo-template"
                      value={cargoTemplateId}
                      onChange={setCargoTemplateId}
                      disabled={isCargoLoading}
                      placeholder={isCargoLoading ? 'Carregando templates...' : 'Nenhum selecionado (Opcional)'}
                      options={cargoTemplates.map(template => ({
                        value: template.id,
                        label: `${template.label} • ${template.banca} • ${template.totalQuestions}Q`
                      }))}
                    />
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="exam-list__wizard-footer">
              <Button type="button" variant="ghost" onClick={handlePrev} disabled={step === 1}>
                Retornar
              </Button>
              {step < 3 ? (
                <Button type="button" onClick={handleNext}>
                  Próxima Rotina
                </Button>
              ) : (
                <Button type="submit" loading={isSubmitting}>
                  {isSubmitting ? 'Iniciando Compressão...' : 'Enviar à Singularidade'}
                </Button>
              )}
            </div>

            {renderLogs('exam-list__live-logs--embedded')}
          </form>
        </div>

        {/* PREVIEW RIGHT SIDE */}
        <div className="exam-list__preview-pane">
          <ExamSingularityCard exam={previewExam} step={step} />
        </div>
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
          <FlipDrawerGallery
            exams={examsQuery.data}
            onExamClick={(exam) => navigate(`/exam/${exam.id}`)}
            onExamEdit={() => {
              toast('Módulo de edição em desenvolvimento.', 'info');
            }}
            onExamDelete={() => {
              toast('Módulo de exclusão em desenvolvimento.', 'info');
            }}
          />
        )}
      </div>
    </section>
  );
}
