import type { BankQuestion } from '../api/bank';

const EXAM_SESSION_MAP_KEY = 'singular:exam-session-map';
const SESSION_EXAM_MAP_KEY = 'singular:session-exam-map';
const SESSION_QUESTIONS_KEY = 'singular:session-questions-map';
const SESSION_BANK_QUESTIONS_KEY = 'singular:session-bank-questions-map';

type MapShape = Record<string, string>;
type SessionQuestionsShape = Record<string, string[]>;
type SessionBankQuestionsShape = Record<string, BankQuestion[]>;

function readMap(key: string): MapShape {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as MapShape;
  } catch {
    return {};
  }
}

function writeMap(key: string, value: MapShape | SessionQuestionsShape | SessionBankQuestionsShape) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readSessionQuestions(): SessionQuestionsShape {
  const raw = localStorage.getItem(SESSION_QUESTIONS_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as SessionQuestionsShape;
  } catch {
    return {};
  }
}

function readSessionBankQuestions(): SessionBankQuestionsShape {
  const raw = localStorage.getItem(SESSION_BANK_QUESTIONS_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as SessionBankQuestionsShape;
  } catch {
    return {};
  }
}

/**
 * Persiste a sessão ativa do exame + o snapshot ordenado de questões
 * (conjunto retornado por POST /quiz/start — necessário porque o player
 * filtra/ordena `GET /exams/:id/questions` por esse snapshot ao resumir).
 */
export function saveExamSession(examId: string, sessionId: string, questionIds?: string[]) {
  const examToSession = readMap(EXAM_SESSION_MAP_KEY);
  examToSession[examId] = sessionId;
  writeMap(EXAM_SESSION_MAP_KEY, examToSession);

  const sessionToExam = readMap(SESSION_EXAM_MAP_KEY);
  sessionToExam[sessionId] = examId;
  writeMap(SESSION_EXAM_MAP_KEY, sessionToExam);

  if (questionIds && questionIds.length > 0) {
    const sessionQuestions = readSessionQuestions();
    sessionQuestions[sessionId] = questionIds;
    writeMap(SESSION_QUESTIONS_KEY, sessionQuestions);
  }
}

export function getSessionByExamId(examId: string): string | null {
  return readMap(EXAM_SESSION_MAP_KEY)[examId] ?? null;
}

export function getExamBySessionId(sessionId: string): string | null {
  return readMap(SESSION_EXAM_MAP_KEY)[sessionId] ?? null;
}

/** Snapshot de questões da sessão (null quando sessão veio de outro device). */
export function getSessionQuestionIds(sessionId: string): string[] | null {
  return readSessionQuestions()[sessionId] ?? null;
}

/**
 * Payload completo das questões de uma sessão mode='bank'.
 * Necessário porque o exame sintético kind='bank' não tem questões próprias —
 * GET /exams/:bankExamId/questions retorna vazio. Os dados já estavam na
 * tela no momento do "Montar Simulado", então persistimos junto do snapshot.
 */
export function saveSessionBankQuestions(sessionId: string, questions: BankQuestion[]) {
  const sessions = readSessionBankQuestions();
  sessions[sessionId] = questions;
  writeMap(SESSION_BANK_QUESTIONS_KEY, sessions);
}

export function getSessionBankQuestions(sessionId: string): BankQuestion[] | null {
  return readSessionBankQuestions()[sessionId] ?? null;
}

export function clearExamSession(examId: string, sessionId: string) {
  const examToSession = readMap(EXAM_SESSION_MAP_KEY);
  if (examToSession[examId] === sessionId) {
    delete examToSession[examId];
    writeMap(EXAM_SESSION_MAP_KEY, examToSession);
  }

  const sessionToExam = readMap(SESSION_EXAM_MAP_KEY);
  if (sessionToExam[sessionId] === examId) {
    delete sessionToExam[sessionId];
    writeMap(SESSION_EXAM_MAP_KEY, sessionToExam);
  }

  const sessionQuestions = readSessionQuestions();
  if (sessionId in sessionQuestions) {
    delete sessionQuestions[sessionId];
    writeMap(SESSION_QUESTIONS_KEY, sessionQuestions);
  }

  const bankQuestions = readSessionBankQuestions();
  if (sessionId in bankQuestions) {
    delete bankQuestions[sessionId];
    writeMap(SESSION_BANK_QUESTIONS_KEY, bankQuestions);
  }
}
