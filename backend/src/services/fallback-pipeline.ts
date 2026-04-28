import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config.js';

export interface PipelineQuestion {
  order: number;
  questionText: string;
  options: string[];
  correctAnswer?: string;
  sourcePage?: number;
  contextText?: string;
}

export interface PipelineSuccessResult {
  status: 'ok';
  usedPath: string;  // Provider name: docling, gemini, ollama-glm-ocr, ollama-qwen-vl, etc.
  fallbackTriggered: boolean;
  fallbackReason?: string;
  totalQuestions: number;
  questions: PipelineQuestion[];
  extractionChars: number;
}

export interface PipelineErrorResult {
  status: 'error';
  errorCode: string;
  message: string;
}

export type PipelineResult = PipelineSuccessResult | PipelineErrorResult;

interface RunFallbackPipelineInput {
  examId: string;
  filePath: string;
  fallbackReason: string;
  pageStart?: number;
  pageEnd?: number;
  provaType?: string;
}

interface PythonPayload {
  exam_id: string;
  file_path: string;
  fallback_reason: string;
  extract_min_chars: number;
  gemini_model: string;
  gemini_api_key?: string;
  page_start?: number;
  page_end?: number;
  prova_type?: string;
}

function resolvePipelineEntrypoint(): string {
  if (path.isAbsolute(config.pipelineEntrypoint)) {
    return config.pipelineEntrypoint;
  }

  return path.resolve(process.cwd(), config.pipelineEntrypoint);
}

export async function runFallbackPipeline(input: RunFallbackPipelineInput): Promise<PipelineResult> {
  const entrypoint = resolvePipelineEntrypoint();

  const payload: PythonPayload = {
    exam_id: input.examId,
    file_path: input.filePath,
    fallback_reason: input.fallbackReason,
    extract_min_chars: config.pipelineExtractMinChars,
    gemini_model: config.pipelineGeminiModel,
    gemini_api_key: config.geminiApiKey,
    page_start: input.pageStart,
    page_end: input.pageEnd,
    prova_type: input.provaType,
  };

  const child = spawn(config.pipelinePythonBin, [entrypoint], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  console.log(`[Python Worker] Spawned with PID: ${child.pid}`);

  return await new Promise<PipelineResult>((resolve) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      if (process.env.DEBUG) console.log(`[Python Stdout] ${chunk.toString('utf8').substring(0, 50)}...`);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      resolve({
        status: 'error',
        errorCode: 'PIPELINE_PROCESS_ERROR',
        message: error.message,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          status: 'error',
          errorCode: 'PIPELINE_EXIT_NON_ZERO',
          message: stderrBuffer.trim() || `Pipeline exited with code ${String(code)}`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdoutBuffer) as PipelineResult;
        resolve(parsed);
      } catch {
        resolve({
          status: 'error',
          errorCode: 'PIPELINE_INVALID_OUTPUT',
          message: 'Pipeline output is not valid JSON',
        });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}
