import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  createBankSession,
  fetchBankFilters,
  fetchBankQuestions,
  type BankDifficulty,
  type BankQuestion,
} from '../api/bank';
import { Button } from '../components/ui/Button';
import { FuiSelect } from '../components/ui/FuiSelect';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { toast } from '../components/ui/ToastUtils';
import { saveExamSession, saveSessionBankQuestions } from './quizSessionStorage';
import './BankPage.css';

const PAGE_SIZE = 25;
const QUICK_SELECT_LIMIT = 30;
const SEARCH_DEBOUNCE_MS = 350;

const DIFFICULTY_LABELS: Record<BankDifficulty, string> = {
  easy: 'Fácil',
  medium: 'Média',
  hard: 'Difícil',
};

const DIFFICULTY_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'easy', label: 'Fácil' },
  { value: 'medium', label: 'Média' },
  { value: 'hard', label: 'Difícil' },
];

const OPTION_PREFIX_RE = /^([A-Ea-e])\s*[).:-]\s*/;

/**
 * Resolve o gabarito para exibição: se a resposta é uma letra (A–E),
 * anexa o texto da alternativa correspondente.
 */
function resolveGabarito(question: BankQuestion): string {
  const raw = question.correctAnswer?.trim() ?? '';
  if (!raw) {
    return '—';
  }

  const letter = raw.toUpperCase();
  let index = question.options.findIndex(
    (option) => option.trim().match(OPTION_PREFIX_RE)?.[1]?.toUpperCase() === letter,
  );

  if (index < 0 && letter.length === 1) {
    const positional = letter.charCodeAt(0) - 65; // 'A' → 0
    if (positional >= 0 && positional < question.options.length) {
      index = positional;
    }
  }

  if (index >= 0) {
    const optionText = question.options[index].trim().replace(OPTION_PREFIX_RE, '');
    return `${letter} — ${optionText}`;
  }

  return raw;
}

export function BankPage() {
  const navigate = useNavigate();

  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [banca, setBanca] = useState('');
  const [year, setYear] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  // Payloads das questões selecionadas — necessário porque sessões bank são
  // ancoradas num exame sintético sem questões próprias (o player consome
  // este cache; ver getSessionBankQuestions no QuizPlayerPage).
  const questionCache = useRef(new Map<string, BankQuestion>());

  // Debounce da busca (~350ms) — volta para a página 1 a cada termo novo.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedQ(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [search]);

  const filtersQuery = useQuery({
    queryKey: ['bank-filters'],
    queryFn: fetchBankFilters,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const questionsQuery = useQuery({
    queryKey: ['bank-questions', { subject, topic, difficulty, banca, year, q: debouncedQ, page }],
    queryFn: () =>
      fetchBankQuestions({
        subject: subject || undefined,
        topic: topic || undefined,
        difficulty: (difficulty || undefined) as BankDifficulty | undefined,
        banca: banca || undefined,
        year: year ? Number(year) : undefined,
        q: debouncedQ || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const sessionMutation = useMutation({
    mutationFn: (questionIds: string[]) => createBankSession(questionIds),
    onSuccess: (session) => {
      saveExamSession(session.examId, session.sessionId, session.questionIds);
      const payloads = session.questionIds
        .map((id) => questionCache.current.get(id))
        .filter((q): q is BankQuestion => Boolean(q));
      if (payloads.length > 0) {
        saveSessionBankQuestions(session.sessionId, payloads);
      }
      navigate(`/quiz/${session.examId}?session=${session.sessionId}`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Falha ao montar simulado.', 'error');
    },
  });

  const data = questionsQuery.data;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters = Boolean(subject || topic || difficulty || banca || year || debouncedQ);

  const applyFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const clearFilters = () => {
    setSubject('');
    setTopic('');
    setDifficulty('');
    setBanca('');
    setYear('');
    setSearch('');
    setDebouncedQ('');
    setPage(1);
  };

  const toggleSelected = (question: BankQuestion) => {
    const id = question.id;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        questionCache.current.delete(id);
      } else {
        next.add(id);
        questionCache.current.set(id, question);
      }
      return next;
    });
  };

  const toggleRevealed = (id: string) => {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // "Selecionar até N do filtro" — união com os primeiros N do resultado atual.
  const selectUpToLimit = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of items.slice(0, QUICK_SELECT_LIMIT)) {
        next.add(item.id);
        questionCache.current.set(item.id, item);
      }
      return next;
    });
  };

  const changePage = (next: number) => {
    setPage(next);
    window.scrollTo({ top: 0 });
  };

  const buildSession = () => {
    if (selected.size === 0 || sessionMutation.isPending) {
      return;
    }
    sessionMutation.mutate(Array.from(selected));
  };

  const filters = filtersQuery.data;
  const toOptions = (allLabel: string, values: string[]) => [
    { value: '', label: allLabel },
    ...values.map((value) => ({ value, label: value })),
  ];

  const subtitle = questionsQuery.isLoading
    ? 'SYS.ARCHIVE // escaneando fragmentos...'
    : `SYS.ARCHIVE // ${total} fragmento${total === 1 ? '' : 's'} catalogado${total === 1 ? '' : 's'}`;

  return (
    <section className="bank page page-container">
      <header className="bank__header">
        <h1 className="bank__title">Banco de Questões</h1>
        <p className="bank__subtitle">{subtitle}</p>
      </header>

      <div className="bank__terminal">
        <div className="bank__premium-glow" />

        <div className="bank__filters" role="group" aria-label="Filtros do banco">
          <div className="bank__filter">
            <label className="bank__filter-label" htmlFor="bank-filter-subject">
              Disciplina
            </label>
            <FuiSelect
              id="bank-filter-subject"
              value={subject}
              onChange={applyFilter(setSubject)}
              options={toOptions('Todas', filters?.subjects ?? [])}
              placeholder={filtersQuery.isLoading ? 'Carregando...' : 'Todas'}
              disabled={filtersQuery.isLoading}
            />
          </div>

          <div className="bank__filter">
            <label className="bank__filter-label" htmlFor="bank-filter-topic">
              Assunto
            </label>
            <FuiSelect
              id="bank-filter-topic"
              value={topic}
              onChange={applyFilter(setTopic)}
              options={toOptions('Todos', filters?.topics ?? [])}
              placeholder={filtersQuery.isLoading ? 'Carregando...' : 'Todos'}
              disabled={filtersQuery.isLoading}
            />
          </div>

          <div className="bank__filter">
            <label className="bank__filter-label" htmlFor="bank-filter-difficulty">
              Dificuldade
            </label>
            <FuiSelect
              id="bank-filter-difficulty"
              value={difficulty}
              onChange={applyFilter(setDifficulty)}
              options={DIFFICULTY_OPTIONS}
              placeholder="Todas"
            />
          </div>

          <div className="bank__filter">
            <label className="bank__filter-label" htmlFor="bank-filter-banca">
              Banca
            </label>
            <FuiSelect
              id="bank-filter-banca"
              value={banca}
              onChange={applyFilter(setBanca)}
              options={toOptions('Todas', filters?.bancas ?? [])}
              placeholder={filtersQuery.isLoading ? 'Carregando...' : 'Todas'}
              disabled={filtersQuery.isLoading}
            />
          </div>

          <div className="bank__filter">
            <label className="bank__filter-label" htmlFor="bank-filter-year">
              Ano
            </label>
            <FuiSelect
              id="bank-filter-year"
              value={year}
              onChange={applyFilter(setYear)}
              options={[
                { value: '', label: 'Todos' },
                ...(filters?.years ?? []).map((value) => ({ value: String(value), label: String(value) })),
              ]}
              placeholder={filtersQuery.isLoading ? 'Carregando...' : 'Todos'}
              disabled={filtersQuery.isLoading}
            />
          </div>

          <div className="bank__filter bank__filter--search">
            <Input
              id="bank-filter-q"
              label="Busca"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Enunciado, palavra-chave..."
            />
          </div>

          <div className="bank__filter-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              disabled={!hasActiveFilters && !search}
            >
              Limpar
            </Button>
          </div>
        </div>

        {questionsQuery.isLoading ? (
          <div className="bank__list" aria-hidden="true">
            <Skeleton height="150px" />
            <Skeleton height="150px" />
            <Skeleton height="150px" />
          </div>
        ) : questionsQuery.isError ? (
          <div className="bank__state bank__state--error">
            <p>Ruptura no acesso ao arquivo. Os fragmentos não puderam ser lidos.</p>
            <Button variant="ghost" onClick={() => void questionsQuery.refetch()}>
              Tentar Reconexão
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="bank__state">
            <div className="bank__empty-icon" aria-hidden="true">
              ∅
            </div>
            <p>
              {hasActiveFilters
                ? 'Nenhum fragmento corresponde aos filtros aplicados.'
                : 'Nenhuma questão no banco — processe provas primeiro.'}
            </p>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : null}
          </div>
        ) : (
          <ol className="bank__list">
            {items.map((question) => {
              const isSelected = selected.has(question.id);
              const isRevealed = revealed.has(question.id);

              return (
                <li key={question.id}>
                  <article className={`bank-q${isSelected ? ' bank-q--selected' : ''}`}>
                    <div className="bank-q__head">
                      <label className="bank-q__select">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(question)}
                        />
                        <span className="bank-q__select-label">Selecionar questão</span>
                      </label>
                      <div className="bank-q__badges">
                        {question.annulled ? (
                          <span className="bank-q__badge bank-q__badge--annulled">Anulada</span>
                        ) : null}
                        {question.hasImage ? (
                          <span className="bank-q__badge bank-q__badge--image">Imagem</span>
                        ) : null}
                      </div>
                    </div>

                    <p className="bank-q__text">{question.questionText}</p>

                    {question.contextText ? (
                      <details className="bank-q__context">
                        <summary>Texto-base</summary>
                        <p>{question.contextText}</p>
                      </details>
                    ) : null}

                    <div className="bank-q__meta">
                      {question.subject ? <span className="bank-q__chip">{question.subject}</span> : null}
                      {question.topic ? <span className="bank-q__chip">{question.topic}</span> : null}
                      {question.difficulty ? (
                        <span className={`bank-q__chip bank-q__chip--${question.difficulty}`}>
                          {DIFFICULTY_LABELS[question.difficulty]}
                        </span>
                      ) : null}
                      {question.banca ? <span className="bank-q__chip">{question.banca}</span> : null}
                      {question.year ? <span className="bank-q__chip">{question.year}</span> : null}
                      <span className="bank-q__chip bank-q__chip--source" title="Prova de origem">
                        {question.examTitle}
                      </span>
                    </div>

                    <div className="bank-q__foot">
                      <button
                        type="button"
                        className="bank-q__answer-toggle"
                        aria-expanded={isRevealed}
                        onClick={() => toggleRevealed(question.id)}
                      >
                        {isRevealed ? 'ocultar gabarito' : 'ver gabarito'}
                      </button>
                      {isRevealed ? (
                        <span className="bank-q__answer">Gabarito: {resolveGabarito(question)}</span>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}

        {!questionsQuery.isLoading && !questionsQuery.isError && total > 0 ? (
          <footer className="bank__pagination">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>
              ← Anterior
            </Button>
            <span className="bank__page-info">
              Página {page} de {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => changePage(page + 1)}
            >
              Próxima →
            </Button>
          </footer>
        ) : null}
      </div>

      <div className="bank__selection-bar">
        <div className="bank__selection-inner page-container">
          <span className="bank__selection-count" aria-live="polite">
            <strong>{selected.size}</strong> selecionada{selected.size === 1 ? '' : 's'}
          </span>
          <div className="bank__selection-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={selectUpToLimit}
              disabled={items.length === 0}
            >
              Selecionar até {QUICK_SELECT_LIMIT} do filtro
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Limpar seleção
            </Button>
            <Button
              size="sm"
              onClick={buildSession}
              loading={sessionMutation.isPending}
              disabled={selected.size === 0}
            >
              Montar Simulado →
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
