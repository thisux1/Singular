import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../../config.js';
import type { PendingClassificationQuestion, QuestionClassificationPatch } from '../../repositories/questions-repository.js';
import { logInfo } from '../../utils/logger.js';

type Difficulty = 'easy' | 'medium' | 'hard';

interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface BatchResponseItem {
  index: number;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  cognitive_level?: string | null;
}

interface BatchClassificationResult {
  classified: QuestionClassificationPatch[];
  failedQuestionIds: string[];
  usage: UsageMetrics;
}

const SYSTEM_PROMPT = [
  'Você é um classificador de questões brasileiras (ENEM/FGV/FCC).',
  'Classifique cada item com subject, topic, difficulty e opcional cognitive_level.',
  'difficulty deve ser somente: easy, medium ou hard.',
  'Responda estritamente em JSON válido no schema solicitado.',
  'Few-shot examples (gold-standard):',
  '[EX1 ENEM] Q: "Uma função afim f(x)=2x+3..." -> {subject:"matemática", topic:"função afim", difficulty:"easy", cognitive_level:"aplicação"}',
  '[EX2 FGV] Q: "No trecho ... concordância verbal ..." -> {subject:"português", topic:"concordância verbal", difficulty:"medium", cognitive_level:"análise"}',
  '[EX3 FCC] Q: "A Revolução de 1930 ..." -> {subject:"história", topic:"era vargas", difficulty:"medium", cognitive_level:"memorização"}',
  '[EX4 ENEM] Q: "Considere a reação de oxirredução ..." -> {subject:"química", topic:"eletroquímica", difficulty:"hard", cognitive_level:"análise"}',
  '[EX5 FGV] Q: "No gráfico de cinemática ... aceleração média" -> {subject:"física", topic:"cinemática", difficulty:"medium", cognitive_level:"aplicação"}',
].join('\n');

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBatchItems(jsonText: string): BatchResponseItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('CLASSIFICATION_INVALID_JSON');
  }

  const itemsNode = isObject(parsed) ? parsed.items : undefined;
  if (!Array.isArray(itemsNode)) {
    throw new Error('CLASSIFICATION_INVALID_SCHEMA');
  }

  const items: BatchResponseItem[] = [];

  for (const item of itemsNode) {
    if (!isObject(item)) {
      continue;
    }

    const index = item.index;
    const subject = toTrimmedString(item.subject);
    const topic = toTrimmedString(item.topic);
    const difficulty = item.difficulty;
    const cognitiveLevelRaw = item.cognitive_level;

    if (
      typeof index !== 'number'
      || !Number.isInteger(index)
      || !subject
      || !topic
      || !isDifficulty(difficulty)
    ) {
      continue;
    }

    items.push({
      index,
      subject,
      topic,
      difficulty,
      cognitive_level: typeof cognitiveLevelRaw === 'string' ? cognitiveLevelRaw.trim() : null,
    });
  }

  if (items.length === 0) {
    throw new Error('CLASSIFICATION_INVALID_SCHEMA');
  }

  return items;
}

function usageFromResponse(response: unknown): UsageMetrics {
  if (!isObject(response)) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
  }

  const usage = isObject(response.usageMetadata) ? response.usageMetadata : {};
  const promptTokenCountRaw = usage.promptTokenCount;
  const responseTokenCountRaw = usage.responseTokenCount;
  const candidatesTokenCountRaw = usage.candidatesTokenCount;
  const totalTokenCountRaw = usage.totalTokenCount;

  const inputTokens = typeof promptTokenCountRaw === 'number' ? promptTokenCountRaw : 0;
  const responseTokenCount = typeof responseTokenCountRaw === 'number' ? responseTokenCountRaw : undefined;
  const candidatesTokenCount = typeof candidatesTokenCountRaw === 'number' ? candidatesTokenCountRaw : undefined;
  const outputTokens = responseTokenCount ?? candidatesTokenCount ?? 0;
  const totalTokens = typeof totalTokenCountRaw === 'number' ? totalTokenCountRaw : inputTokens + outputTokens;

  const estimatedCostUsd =
    (inputTokens / 1_000_000) * config.classificationInputUsdPer1M
    + (outputTokens / 1_000_000) * config.classificationOutputUsdPer1M;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
  };
}

async function withTimeout<T>(promiseFactory: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('CLASSIFICATION_TIMEOUT'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promiseFactory(), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function toBatchPrompt(batch: PendingClassificationQuestion[]): string {
  const payload = batch.map((item, index) => ({
    index,
    questionText: item.questionText,
    options: item.options,
  }));

  return [
    SYSTEM_PROMPT,
    'Classifique os itens abaixo:',
    JSON.stringify(payload),
  ].join('\n\n');
}

function createResponseSchema() {
  return {
    type: Type.OBJECT,
    required: ['items'],
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['index', 'subject', 'topic', 'difficulty'],
          properties: {
            index: { type: Type.INTEGER },
            subject: { type: Type.STRING },
            topic: { type: Type.STRING },
            difficulty: { type: Type.STRING, enum: ['easy', 'medium', 'hard'] },
            cognitive_level: { type: Type.STRING, nullable: true },
          },
        },
      },
    },
  };
}

class GeminiClassifierService {
  private readonly client: GoogleGenAI;

  constructor() {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY_MISSING');
    }

    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  private async classifyBatchRaw(
    examId: string,
    batch: PendingClassificationQuestion[],
  ): Promise<{ items: BatchResponseItem[]; usage: UsageMetrics }> {
    const startedAt = Date.now();
    const response = await withTimeout(
      () =>
        this.client.models.generateContent({
          model: config.classificationModel,
          contents: toBatchPrompt(batch),
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseJsonSchema: createResponseSchema(),
          },
        }),
      config.classificationRequestTimeoutMs,
    );

    const usage = usageFromResponse(response);
    const durationMs = Date.now() - startedAt;

    logInfo('classification.batch.request', {
      examId,
      batch_size: batch.length,
      duration_ms: durationMs,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: Number(usage.estimatedCostUsd.toFixed(8)),
    });

    const jsonText = typeof response.text === 'string' ? response.text : '';
    const items = parseBatchItems(jsonText);
    return { items, usage };
  }

  private async classifyBatchWithRetry(
    examId: string,
    batch: PendingClassificationQuestion[],
  ): Promise<{ items: BatchResponseItem[]; usage: UsageMetrics }> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= config.classificationMaxRetries) {
      try {
        return await this.classifyBatchRaw(examId, batch);
      } catch (error) {
        const err = error instanceof Error ? error : new Error('CLASSIFICATION_UNKNOWN_ERROR');

        if (err.message === 'CLASSIFICATION_TIMEOUT') {
          throw err;
        }

        const isSchemaError =
          err.message === 'CLASSIFICATION_INVALID_SCHEMA' || err.message === 'CLASSIFICATION_INVALID_JSON';

        if (!isSchemaError) {
          throw err;
        }

        lastError = err;
        attempt += 1;
        if (attempt > config.classificationMaxRetries) {
          break;
        }
      }
    }

    throw lastError ?? new Error('CLASSIFICATION_SCHEMA_RETRIES_EXHAUSTED');
  }

  async classifyBatch(examId: string, batch: PendingClassificationQuestion[]): Promise<BatchClassificationResult> {
    const classified: QuestionClassificationPatch[] = [];
    const failedQuestionIds: string[] = [];
    let aggregatedUsage: UsageMetrics = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };

    const expectedIndexes = new Set(batch.map((_, index) => index));

    try {
      const { items, usage } = await this.classifyBatchWithRetry(examId, batch);
      aggregatedUsage = {
        inputTokens: aggregatedUsage.inputTokens + usage.inputTokens,
        outputTokens: aggregatedUsage.outputTokens + usage.outputTokens,
        totalTokens: aggregatedUsage.totalTokens + usage.totalTokens,
        estimatedCostUsd: aggregatedUsage.estimatedCostUsd + usage.estimatedCostUsd,
      };

      for (const item of items) {
        if (!expectedIndexes.has(item.index)) {
          continue;
        }

        const question = batch[item.index];
        classified.push({
          questionId: question.id,
          subject: item.subject,
          topic: item.topic,
          difficulty: item.difficulty,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('CLASSIFICATION_UNKNOWN_ERROR');
      if (err.message === 'CLASSIFICATION_TIMEOUT') {
        return {
          classified: [],
          failedQuestionIds: batch.map((item) => item.id),
          usage: aggregatedUsage,
        };
      }
    }

    const classifiedIds = new Set(classified.map((item) => item.questionId));
    const missing = batch.filter((item) => !classifiedIds.has(item.id));

    for (const item of missing) {
      try {
        const { items, usage } = await this.classifyBatchWithRetry(examId, [item]);
        aggregatedUsage = {
          inputTokens: aggregatedUsage.inputTokens + usage.inputTokens,
          outputTokens: aggregatedUsage.outputTokens + usage.outputTokens,
          totalTokens: aggregatedUsage.totalTokens + usage.totalTokens,
          estimatedCostUsd: aggregatedUsage.estimatedCostUsd + usage.estimatedCostUsd,
        };

        const single = items[0];
        if (!single) {
          failedQuestionIds.push(item.id);
          continue;
        }

        classified.push({
          questionId: item.id,
          subject: single.subject,
          topic: single.topic,
          difficulty: single.difficulty,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error('CLASSIFICATION_UNKNOWN_ERROR');
        if (err.message === 'CLASSIFICATION_TIMEOUT') {
          failedQuestionIds.push(item.id);
          continue;
        }

        failedQuestionIds.push(item.id);
      }
    }

    return {
      classified,
      failedQuestionIds,
      usage: aggregatedUsage,
    };
  }
}

let classifierInstance: GeminiClassifierService | null = null;

export function getGeminiClassifierService(): GeminiClassifierService {
  if (!classifierInstance) {
    classifierInstance = new GeminiClassifierService();
  }

  return classifierInstance;
}
