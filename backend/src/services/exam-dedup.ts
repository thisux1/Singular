import {
  examsRepository,
  type StoredExamRecord,
} from '../repositories/exams-repository.js';
import { questionsRepository } from '../repositories/questions-repository.js';
import { logInfo } from '../utils/logger.js';

/**
 * Dedup de upload em camadas (extensão do D24):
 *
 * a) `same-user` — mesmo usuário + mesmo fileHash → comportamento original
 *    (retorna o exame existente, sem regravar arquivo nem reprocessar).
 * b) `clone` — OUTRO usuário já processou o mesmo hash e o exame está
 *    `completed` → o caller cria exame próprio e CLONA as questions do
 *    exame-fonte (não enfileira processamento).
 * c) `none` — hash inédito ou existente só em exames não-finalizados →
 *    fluxo normal (salva + enfileira).
 *
 * Com `ownershipId === undefined` (AUTH_DISABLED, dev single-user) a camada
 * (a) já enxerga todos os exames — o modo dev nunca entra em `clone`.
 */
export type UploadDedupResolution =
  | { type: 'same-user'; exam: StoredExamRecord }
  | { type: 'clone'; source: StoredExamRecord }
  | { type: 'none' };

export async function resolveUploadDedup(
  ownershipId: string | undefined,
  fileHash: string,
): Promise<UploadDedupResolution> {
  const existing = await examsRepository.findByFileHash(ownershipId, fileHash);
  if (existing) {
    return { type: 'same-user', exam: existing };
  }

  const source = await examsRepository.findCompletedByFileHash(fileHash);
  if (source) {
    return { type: 'clone', source };
  }

  return { type: 'none' };
}

/**
 * Finaliza um exame recém-criado a partir do exame-fonte: clona as questions
 * (novos ids, mesmo conteúdo/classificação/explicações) e marca `completed`
 * com parsingLog de auditoria. NÃO enfileira job — o retorno do upload é
 * `{deduped:true, cloned:true}` e o exame já nasce utilizável.
 */
export async function completeExamFromClone(
  target: StoredExamRecord,
  source: StoredExamRecord,
): Promise<number> {
  const cloned = await questionsRepository.cloneToExam(source.id, target.id);

  await examsRepository.updateStatus(target.id, 'completed', {
    totalQuestions: source.totalQuestions ?? cloned,
    parsingLog: {
      dedupedFrom: source.id,
      clonedQuestions: cloned,
    },
  });

  logInfo('exam.upload.cloned', {
    examId: target.id,
    userId: target.userId,
    sourceExamId: source.id,
    clonedQuestions: cloned,
  });

  return cloned;
}
