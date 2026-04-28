export type ExamStatus = 'queued' | 'processing' | 'reviewing' | 'completed' | 'failed';
export type ExtractionTier = 'fastpath' | 'repair' | 'gemini';

export interface ExamRecord {
  id: string;
  title: string;
  originalFilename: string;
  filePath: string;
  fileType: 'pdf' | 'image';
  status: ExamStatus;
  errorMessage?: string;
  totalQuestions?: number;
  pageOffset?: number;
  pageStart?: number;
  pageEnd?: number;
  provaType?: string;
  cargoTemplateId?: string;
  edital?: string;
  examDate?: string;
  gabaritoPath?: string;
  extractionTier?: ExtractionTier;
  parsingLog?: Record<string, unknown>;
  createdAt: string;
  processedAt?: string;
}
