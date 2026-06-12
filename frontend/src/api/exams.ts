import { apiFetch } from './client';

export type ExamStatus = 'queued' | 'processing' | 'reviewing' | 'completed' | 'failed';

export type Exam = {
  id: string;
  title: string;
  status: ExamStatus;
  totalQuestions: number | null;
  errorMessage: string | null;
  pageOffset: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  provaType?: string | null;
  cargoTemplateId?: string | null;
  edital?: string | null;
  examDate?: string | null;
  createdAt?: string;
};

export type UploadExamPayload = {
  file: File;
  gabaritoFile?: File;
  title?: string;
  edital?: string;
  examDate?: string;
  provaType?: string;
  cargoTemplateId?: string;
  pageStart?: number;
  pageEnd?: number;
};

export type CargoTemplateCatalogItem = {
  id: string;
  label: string;
  banca: string;
  totalQuestions: number;
};

export type QuestionOption = string;

export type Question = {
  id: string;
  examId: string;
  order: number;
  questionText: string;
  options: QuestionOption[];
  sourcePage?: number | null;
  difficulty?: string | null;
  subject?: string | null;
  topic?: string | null;
  confidence?: number | null;
  correctAnswer?: string | null;
  contextText?: string | null;
};

type ExamsResponse = { exams: Exam[] };
type QuestionsResponse = { questions: Question[] };
type UploadResponse = { exam_id: string; status: ExamStatus };
type CargoTemplatesResponse = { templates: CargoTemplateCatalogItem[] };

export async function fetchExams(): Promise<Exam[]> {
  const data = await apiFetch<ExamsResponse>('/exams');
  return data.exams;
}

export function fetchExam(id: string): Promise<Exam> {
  return apiFetch<Exam>(`/exams/${id}`);
}

export async function uploadExam(payload: UploadExamPayload): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', payload.file);

  if (payload.gabaritoFile) {
    formData.append('gabaritoFile', payload.gabaritoFile);
  }

  if (payload.title) {
    formData.append('title', payload.title);
  }

  if (payload.edital) {
    formData.append('edital', payload.edital);
  }

  if (payload.examDate) {
    formData.append('examDate', payload.examDate);
  }

  if (payload.provaType) {
    formData.append('provaType', payload.provaType);
  }

  if (payload.cargoTemplateId) {
    formData.append('cargoTemplateId', payload.cargoTemplateId);
  }

  if (payload.pageStart !== undefined) {
    formData.append('pageStart', String(payload.pageStart));
  }

  if (payload.pageEnd !== undefined) {
    formData.append('pageEnd', String(payload.pageEnd));
  }

  return apiFetch<UploadResponse>('/exams/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function fetchCargoTemplates(): Promise<CargoTemplateCatalogItem[]> {
  const data = await apiFetch<CargoTemplatesResponse>('/exams/cargo-templates');
  return data.templates;
}

export function publishExam(id: string): Promise<{ success: boolean; status: ExamStatus }> {
  return apiFetch<{ success: boolean; status: ExamStatus }>(`/exams/${id}/publish`, {
    method: 'POST',
  });
}

export function deleteExam(id: string): Promise<{ status: string; exam_id: string }> {
  return apiFetch<{ status: string; exam_id: string }>(`/exams/${id}`, {
    method: 'DELETE',
  });
}

export async function fetchExamQuestions(id: string): Promise<Question[]> {
  const data = await apiFetch<QuestionsResponse>(`/exams/${id}/questions`);
  return data.questions;
}

export function reprocessExam(id: string): Promise<{ exam_id: string; status: ExamStatus }> {
  return apiFetch<{ exam_id: string; status: ExamStatus }>(`/exams/${id}/reprocess`, {
    method: 'POST',
  });
}
