import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import type { QuestionRow } from '../db/schema.js';
import { logInfo } from '../utils/logger.js';

/**
 * Explainer (D20): gera explicação didática da questão via Gemini structured
 * output. Persistido em questions.explanation/explanation_steps/common_mistakes
 * pela rota (cache — primeira chamada gera, demais retornam o persistido).
 */
export interface ExplanationResult {
  explanation: string;
  explanationSteps: string[];
  commonMistakes: string[];
}

const EXPLAIN_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = [
  'Você é um professor especialista em concursos públicos brasileiros (Cesgranrio, FGV, FCC).',
  'Explique a questão objetiva para um estudante que está revisando o resultado de um simulado.',
  'Estruture a resposta em:',
  '- explanation: parágrafo explicando por que a alternativa correta é correta (e por que a marcada, se fornecida, está errada).',
  '- explanationSteps: passo a passo curto (2 a 6 itens) de como resolver a questão.',
  '- commonMistakes: erros comuns que levam a marcar alternativas erradas (1 a 4 itens).',
  'Responda estritamente em JSON válido no schema solicitado.',
].join('\n');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseExplanation(jsonText: string): ExplanationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('EXPLAINER_INVALID_JSON');
  }

  if (!isObject(parsed)) {
    throw new Error('EXPLAINER_INVALID_SCHEMA');
  }

  const explanation = typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '';
  if (explanation.length === 0) {
    throw new Error('EXPLAINER_INVALID_SCHEMA');
  }

  return {
    explanation,
    explanationSteps: toStringArray(parsed.explanationSteps),
    commonMistakes: toStringArray(parsed.commonMistakes),
  };
}

function createResponseSchema() {
  return {
    type: Type.OBJECT,
    required: ['explanation', 'explanationSteps', 'commonMistakes'],
    properties: {
      explanation: { type: Type.STRING },
      explanationSteps: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      commonMistakes: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
  };
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

function toPrompt(question: QuestionRow): string {
  const options = Array.isArray(question.options) ? question.options : [];
  const optionsText = options
    .map((option, index) => `(${OPTION_LETTERS[index] ?? index}) ${option}`)
    .join('\n');

  return [
    SYSTEM_PROMPT,
    [
      'Questão:',
      question.questionText,
      ...(question.contextText ? ['', 'Texto-base:', question.contextText] : []),
      '',
      'Alternativas:',
      optionsText,
      '',
      `Alternativa correta (gabarito): ${question.correctAnswer ?? 'desconhecida'}`,
      ...(question.subject ? [`Disciplina: ${question.subject}`] : []),
      ...(question.topic ? [`Tópico: ${question.topic}`] : []),
      question.annulled
        ? 'ATENÇÃO: esta questão foi ANULADA pela banca — explique o motivo provável da anulação.'
        : '',
    ].join('\n'),
  ].join('\n\n');
}

class ExplainerService {
  private readonly client: GoogleGenAI;

  constructor() {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY_MISSING');
    }

    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  async generate(question: QuestionRow): Promise<ExplanationResult> {
    const startedAt = Date.now();

    const response = await this.client.models.generateContent({
      model: config.classificationModel,
      contents: toPrompt(question),
      config: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseJsonSchema: createResponseSchema(),
        abortSignal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
      },
    });

    const durationMs = Date.now() - startedAt;
    logInfo('explainer.generate.completed', {
      questionId: question.id,
      examId: question.examId,
      duration_ms: durationMs,
      model: config.classificationModel,
    });

    const jsonText = typeof response.text === 'string' ? response.text : '';
    return parseExplanation(jsonText);
  }
}

let explainerInstance: ExplainerService | null = null;

/** Lança GEMINI_API_KEY_MISSING quando a chave não está configurada. */
export function getExplainerService(): ExplainerService {
  if (!explainerInstance) {
    explainerInstance = new ExplainerService();
  }

  return explainerInstance;
}
