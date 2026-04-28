const EXAM_SESSION_MAP_KEY = 'quizsaber:exam-session-map';
const SESSION_EXAM_MAP_KEY = 'quizsaber:session-exam-map';

type MapShape = Record<string, string>;

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

function writeMap(key: string, value: MapShape) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function saveExamSession(examId: string, sessionId: string) {
  const examToSession = readMap(EXAM_SESSION_MAP_KEY);
  examToSession[examId] = sessionId;
  writeMap(EXAM_SESSION_MAP_KEY, examToSession);

  const sessionToExam = readMap(SESSION_EXAM_MAP_KEY);
  sessionToExam[sessionId] = examId;
  writeMap(SESSION_EXAM_MAP_KEY, sessionToExam);
}

export function getSessionByExamId(examId: string): string | null {
  return readMap(EXAM_SESSION_MAP_KEY)[examId] ?? null;
}

export function getExamBySessionId(sessionId: string): string | null {
  return readMap(SESSION_EXAM_MAP_KEY)[sessionId] ?? null;
}
