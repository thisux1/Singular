#!/usr/bin/env node
/**
 * Seed E2E — prova sintética "completed" + 5 questões.
 *
 * Idempotente: apaga qualquer exame marcado com E2E_EXAM_TITLE (cascade limpa
 * questions / quiz_sessions / quiz_answers) antes de inserir de novo.
 *
 * Uso:
 *   node e2e/seed.mjs                 → semeia e imprime o examId
 *   DATABASE_URL=... node e2e/seed.mjs
 *
 * Saída: última linha do stdout = examId. Também grava e2e/.e2e-state.json
 * para os specs/local-dev.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const E2E_EXAM_TITLE = 'E2E Prova Sintética';
const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.e2e-state.json',
);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/quizsaber';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// 5 questões: subjects variados, 1 anulada (sem resposta exigida),
// 1 com imagem (badge "ver página" no player).
const QUESTIONS = [
  {
    subject: 'Matemática',
    questionText:
      'E2E-Q1 — Um depósito recebe 3 caixas por hora. Em 8 horas, quantas caixas foram recebidas?',
    options: ['24 caixas', '11 caixas', '32 caixas', '21 caixas'],
    correctAnswer: 'A',
    annulled: false,
    hasImage: false,
    sourcePage: null,
  },
  {
    subject: 'Português',
    questionText:
      'E2E-Q2 — Assinale a alternativa em que todas as palavras estão grafadas corretamente.',
    options: [
      'Exceção, íngreme, abscissa',
      'Exceção, ingreme, abcissa',
      'Exseção, íngreme, abscissa',
      'Exceção, íngrime, abscissa',
    ],
    correctAnswer: 'B',
    annulled: false,
    hasImage: false,
    sourcePage: null,
  },
  {
    subject: 'Direito Constitucional',
    questionText:
      'E2E-Q3 — Segundo a CF/88, a casa do cidadão é asilo inviolável, salvo:',
    options: [
      'em caso de flagrante delito, desastre ou por determinação judicial',
      'a qualquer tempo, mediante ordem de policial militar',
      'somente durante o dia, mesmo sem consentimento',
      'nunca, em hipótese alguma',
    ],
    correctAnswer: 'A',
    annulled: false,
    hasImage: false,
    sourcePage: null,
  },
  {
    subject: 'Matemática',
    questionText:
      'E2E-Q4 — [ANULADA PELA BANCA] Questão com gabarito divergente entre os espelhos.',
    options: ['Alternativa 1', 'Alternativa 2', 'Alternativa 3', 'Alternativa 4'],
    correctAnswer: 'C',
    annulled: true,
    hasImage: false,
    sourcePage: null,
  },
  {
    subject: 'Raciocínio Lógico',
    questionText:
      'E2E-Q5 — Observe a figura (página 3). Qual é o próximo elemento da sequência?',
    options: ['Figura A', 'Figura B', 'Figura C', 'Figura D'],
    correctAnswer: 'D',
    annulled: false,
    hasImage: true,
    sourcePage: 3,
  },
];

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    // Idempotência: o marker é o título fixo. Cascade remove filhos.
    const removed = await client.query(
      `DELETE FROM exams WHERE title = $1 RETURNING id`,
      [E2E_EXAM_TITLE],
    );
    if (removed.rowCount > 0) {
      console.info(`seed: removidos ${removed.rowCount} exame(s) E2E anteriores`);
    }

    const fileHash = sha256(`e2e-synthetic-exam-${E2E_EXAM_TITLE}`);
    const examResult = await client.query(
      `INSERT INTO exams (
         user_id, title, original_filename, file_path, file_key,
         file_hash, file_type, status, total_questions, processed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'pdf', 'completed', $7, now())
       RETURNING id`,
      [
        'system',
        E2E_EXAM_TITLE,
        'e2e-prova-sintetica.pdf',
        'e2e/e2e-prova-sintetica.pdf',
        'e2e/e2e-prova-sintetica.pdf',
        fileHash,
        QUESTIONS.length,
      ],
    );
    const examId = examResult.rows[0].id;

    for (const [index, question] of QUESTIONS.entries()) {
      await client.query(
        `INSERT INTO questions (
           exam_id, "order", question_text, options, correct_answer,
           subject, classification_status, confidence, content_hash,
           source_page, has_image, annulled
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'classified', 0.95, $7, $8, $9, $10)`,
        [
          examId,
          index + 1,
          question.questionText,
          JSON.stringify(question.options),
          question.correctAnswer,
          question.subject,
          sha256(`e2e-q${index + 1}-${question.questionText}`),
          question.sourcePage,
          question.hasImage,
          question.annulled,
        ],
      );
    }

    await client.query('COMMIT');

    writeFileSync(
      STATE_FILE,
      JSON.stringify({ examId, title: E2E_EXAM_TITLE, seededAt: new Date().toISOString() }, null, 2),
    );
    console.info(`seed: ${QUESTIONS.length} questões inseridas`);
    console.info(examId);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('seed.error', error);
  process.exitCode = 1;
});
