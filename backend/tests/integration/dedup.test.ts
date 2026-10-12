import { afterAll, beforeAll, describe, expect } from 'vitest';
import { checkDbAvailable, makeItDb } from '../helpers/db.js';
import {
  createTestUser,
  deleteTestUsers,
  insertExam,
  insertQuestion,
  testUserId,
} from '../helpers/seed.js';
import { examsRepository } from '../../src/repositories/exams-repository.js';
import { questionsRepository } from '../../src/repositories/questions-repository.js';
import { completeExamFromClone, resolveUploadDedup } from '../../src/services/exam-dedup.js';

/**
 * T2 — dedup global em camadas:
 * a) mesmo usuário + hash → 'same-user'
 * b) outro usuário completou o hash → 'clone' (+ cloneToExam completa o exame
 *    sem enfileirar — structural: o caminho retorna antes do enqueue)
 * c) hash só em exame não-completado / kind='bank' → 'none'
 */
describe('dedup global em camadas (T2)', () => {
  let dbUp = false;
  const itDb = makeItDb(() => dbUp);

  const userA = testUserId('dedup-a'); // dono do exame-fonte
  const userB = testUserId('dedup-b'); // uploader que vai clonar
  const users = [userA, userB];

  const HASH_DONE = `it-hash-done-${userA.slice(-8)}`;
  const HASH_PROC = `it-hash-proc-${userA.slice(-8)}`;
  const HASH_BANK = `it-hash-bank-${userA.slice(-8)}`;

  let sourceExamId = '';

  beforeAll(async () => {
    dbUp = await checkDbAvailable();
    if (!dbUp) return;

    await createTestUser(userA);
    await createTestUser(userB);

    // Exame-fonte: userA, completed, kind='exam', 2 questões classificadas.
    const source = await insertExam({
      userId: userA,
      fileHash: HASH_DONE,
      status: 'completed',
      totalQuestions: 2,
      banca: 'Cesgranrio',
    });
    sourceExamId = source.id;

    await insertQuestion({
      examId: source.id,
      order: 1,
      questionText: 'Questão fonte 1 — juros simples',
      correctAnswer: 'C',
      subject: 'Matemática',
      topic: 'Juros',
      difficulty: 'medium',
      classificationStatus: 'classified',
      confidence: 0.9,
      explanation: 'Explicação 1',
      explanationSteps: ['passo 1'],
      commonMistakes: ['erro comum'],
      sourcePage: 3,
      gabaritoMatched: true,
    });
    await insertQuestion({
      examId: source.id,
      order: 2,
      questionText: 'Questão fonte 2 — sintaxe',
      correctAnswer: 'E',
      subject: 'Português',
      topic: 'Sintaxe',
      difficulty: 'hard',
      classificationStatus: 'classified',
      annulled: true,
      hasImage: true,
      requiresPdf: true,
    });

    // Mesmo hash em exame ainda processando → NÃO é fonte de clone.
    await insertExam({
      userId: userA,
      fileHash: HASH_PROC,
      status: 'processing',
    });

    // kind='bank' completed com hash → NUNCA é fonte de clone.
    await insertExam({
      userId: userA,
      fileHash: HASH_BANK,
      status: 'completed',
      kind: 'bank',
    });
  });

  afterAll(async () => {
    if (!dbUp) return;
    await deleteTestUsers(users);
  });

  itDb('camada (b): outro usuário + hash completed → resolution clone', async () => {
    const resolution = await resolveUploadDedup(userB, HASH_DONE);
    expect(resolution.type).toBe('clone');
    if (resolution.type !== 'clone') return;
    expect(resolution.source.id).toBe(sourceExamId);
    expect(resolution.source.status).toBe('completed');
  });

  itDb('camada (a): mesmo usuário + hash → same-user (mesmo sendo completed)', async () => {
    const resolution = await resolveUploadDedup(userA, HASH_DONE);
    expect(resolution.type).toBe('same-user');
    if (resolution.type !== 'same-user') return;
    expect(resolution.exam.id).toBe(sourceExamId);
  });

  itDb('camada (c): hash só em exame processing → none (fluxo normal)', async () => {
    expect((await resolveUploadDedup(userB, HASH_PROC)).type).toBe('none');
  });

  itDb('camada (c): hash em exame kind=bank → none (bank nunca é fonte)', async () => {
    expect((await resolveUploadDedup(userB, HASH_BANK)).type).toBe('none');
    expect(await examsRepository.findCompletedByFileHash(HASH_BANK)).toBeUndefined();
  });

  itDb('hash inexistente → none', async () => {
    expect((await resolveUploadDedup(userB, 'hash-que-nao-existe')).type).toBe('none');
  });

  itDb('ownership undefined (AUTH_DISABLED) → same-user cobre tudo, nunca clona', async () => {
    // Em dev single-user o usuário "enxerga" todos os exames → dedup clássico.
    const resolution = await resolveUploadDedup(undefined, HASH_DONE);
    expect(resolution.type).toBe('same-user');
  });

  itDb('completeExamFromClone clona questions e finaliza SEM enfileirar', async () => {
    const resolution = await resolveUploadDedup(userB, HASH_DONE);
    expect(resolution.type).toBe('clone');
    if (resolution.type !== 'clone') return;

    // Exame criado pelo fluxo normal de upload (queued) → clone finaliza.
    const target = await examsRepository.create({
      userId: userB,
      originalFilename: 'mesma-prova.pdf',
      filePath: `/tmp/${sourceExamId}.pdf`,
      fileHash: HASH_DONE,
      fileType: 'pdf',
    });
    expect(target.status).toBe('queued');

    const cloned = await completeExamFromClone(target, resolution.source);
    expect(cloned).toBe(2);

    const finished = await examsRepository.getById(target.id);
    expect(finished?.status).toBe('completed');
    expect(finished?.totalQuestions).toBe(2); // copiado do exame-fonte
    expect(finished?.processedAt).toBeTruthy();
    expect(finished?.parsingLog?.['dedupedFrom']).toBe(sourceExamId);
    expect(finished?.parsingLog?.['clonedQuestions']).toBe(2);

    // Questions clonadas: ids novos, examId do alvo, conteúdo preservado.
    const clonedRows = await questionsRepository.listByExamId(target.id);
    expect(clonedRows).toHaveLength(2);
    const sourceRows = await questionsRepository.listByExamId(sourceExamId);
    const sourceIds = new Set(sourceRows.map((q) => q.id));

    for (const row of clonedRows) {
      expect(row.examId).toBe(target.id);
      expect(sourceIds.has(row.id)).toBe(false); // id novo
      expect(row.contentHash).toBeTruthy();
    }

    const byOrder = new Map(clonedRows.map((q) => [q.order, q]));
    expect(byOrder.get(1)?.questionText).toBe('Questão fonte 1 — juros simples');
    expect(byOrder.get(1)?.subject).toBe('Matemática');
    expect(byOrder.get(1)?.topic).toBe('Juros');
    expect(byOrder.get(1)?.difficulty).toBe('medium');
    expect(byOrder.get(1)?.correctAnswer).toBe('C');
    expect(byOrder.get(1)?.explanation).toBe('Explicação 1');
    expect(byOrder.get(1)?.explanationSteps).toEqual(['passo 1']);
    expect(byOrder.get(1)?.commonMistakes).toEqual(['erro comum']);
    expect(byOrder.get(1)?.classificationStatus).toBe('classified');
    expect(byOrder.get(2)?.annulled).toBe(true);
    expect(byOrder.get(2)?.hasImage).toBe(true);
    expect(byOrder.get(2)?.requiresPdf).toBe(true);

    // Exame-fonte intacto.
    expect(await questionsRepository.countByExamId(sourceExamId)).toBe(2);
  });
});
