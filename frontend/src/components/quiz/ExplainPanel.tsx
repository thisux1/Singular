import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, getApiErrorCode } from '../../api/client';
import { explainQuestion, type QuestionExplanation } from '../../api/questions';
import { Skeleton } from '../ui/Skeleton';
import './ExplainPanel.css';

type ExplainPanelProps = {
  questionId: string;
};

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loaded'; data: QuestionExplanation }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'error'; message: string };

/**
 * "✦ explicar" → POST /questions/:id/explain.
 * Resultado fica em estado local (não refaz a chamada ao reabrir o card).
 */
export function ExplainPanel({ questionId }: ExplainPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  const explainMutation = useMutation({
    mutationFn: () => explainQuestion(questionId),
    onSuccess: (data) => setState({ kind: 'loaded', data }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 429) {
        setState({
          kind: 'rate-limited',
          message:
            'Limite diário de explicações atingido. A quota renova à meia-noite — os vetores já explicados continuam acessíveis.',
        });
        return;
      }

      if (getApiErrorCode(error) === 'EXPLAINER_UNAVAILABLE') {
        setState({
          kind: 'error',
          message: 'O explicador está indisponível neste ambiente (chave de IA não configurada).',
        });
        return;
      }

      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Falha ao gerar explicação.',
      });
    },
  });

  if (explainMutation.isPending) {
    return (
      <div className="explain-panel explain-panel--loading" role="status" aria-label="Gerando explicação">
        <Skeleton width="30%" height="14px" />
        <Skeleton width="100%" height="14px" />
        <Skeleton width="92%" height="14px" />
        <Skeleton width="60%" height="14px" />
      </div>
    );
  }

  if (state.kind === 'idle') {
    return (
      <button
        type="button"
        className="explain-panel__trigger badge badge--violet"
        onClick={() => explainMutation.mutate()}
        disabled={explainMutation.isPending}
      >
        <span aria-hidden="true">✦</span> explicar
      </button>
    );
  }

  if (state.kind === 'rate-limited') {
    return (
      <div className="explain-panel explain-panel--limited" role="status">
        <span className="explain-panel__limited-icon">◷</span>
        <p>{state.message}</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="explain-panel explain-panel--error" role="alert">
        <p>{state.message}</p>
        <button
          type="button"
          className="explain-panel__trigger badge badge--violet"
          onClick={() => {
            setState({ kind: 'idle' });
            explainMutation.mutate();
          }}
        >
          <span aria-hidden="true">✦</span> tentar novamente
        </button>
      </div>
    );
  }

  const { data } = state;

  return (
    <div className="explain-panel">
      <div className="explain-panel__header">
        <span className="explain-panel__title kicker">✦ Análise do Vetor</span>
        {data.cached ? <span className="explain-panel__cached badge badge--ok">instantâneo</span> : null}
      </div>

      <p className="explain-panel__text">{data.explanation}</p>

      {data.explanationSteps.length > 0 ? (
        <ol className="explain-panel__steps">
          {data.explanationSteps.map((step, index) => (
            <li key={index} className="explain-panel__step">
              {step}
            </li>
          ))}
        </ol>
      ) : null}

      {data.commonMistakes.length > 0 ? (
        <div className="explain-panel__mistakes">
          <span className="explain-panel__mistakes-title">Erros comuns</span>
          <ul>
            {data.commonMistakes.map((mistake, index) => (
              <li key={index}>{mistake}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
