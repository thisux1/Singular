import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config.js';
import { storage } from './storage.js';

/**
 * Upload hardening (D15): o MIME declarado pelo cliente é IGNORADO —
 * o tipo real é detectado por magic bytes via `file-type`. Apenas
 * pdf/png/jpeg/webp são aceitos.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export class UploadError extends Error {
  constructor(
    readonly code: 'INVALID_FILE_TYPE' | 'INVALID_FILE_SIZE',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'UploadError';
  }
}

export interface ValidatedUpload {
  buffer: Buffer;
  originalFilename: string;
  /** MIME real detectado por magic bytes. */
  detectedMime: string;
  fileType: 'pdf' | 'image';
  /** sha256 hex do conteúdo — dedup D24. */
  fileHash: string;
  sizeBytes: number;
}

export interface SavedUpload {
  fileKey: string;
  /** Absoluto no driver local; `gs://bucket/key` no GCS (filePath é NOT NULL). */
  filePath: string;
  originalFilename: string;
  fileType: 'pdf' | 'image';
  fileHash: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * Lê o File para buffer, aplica limite de tamanho (declarado e real) e
 * valida magic bytes. Lança UploadError com `code` para o caller mapear
 * em 415/413.
 */
export async function readAndValidateUpload(file: File): Promise<ValidatedUpload> {
  if (file.size <= 0 || file.size > config.maxUploadSizeBytes) {
    throw new UploadError('INVALID_FILE_SIZE');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length <= 0 || buffer.length > config.maxUploadSizeBytes) {
    throw new UploadError('INVALID_FILE_SIZE');
  }

  const detected = await fileTypeFromBuffer(buffer);
  const detectedMime = detected?.mime;
  if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    throw new UploadError('INVALID_FILE_TYPE');
  }

  return {
    buffer,
    originalFilename: file.name,
    detectedMime,
    fileType: detectedMime === 'application/pdf' ? 'pdf' : 'image',
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.length,
  };
}

/**
 * Persiste no storage com key `exams/<userId>/<examId>/<kind><ext>`
 * (layout BACKEND-SCHEMA §4; ext deriva do MIME real, não do filename).
 */
export async function saveUpload(
  userId: string,
  examId: string,
  upload: ValidatedUpload,
  kind: 'source' | 'gabarito',
): Promise<SavedUpload> {
  const ext = EXT_BY_MIME[upload.detectedMime] ?? '.bin';
  const fileKey = `exams/${userId}/${examId}/${kind}${ext}`;

  await storage.put(fileKey, upload.buffer, upload.detectedMime);

  const filePath = storage.resolveLocalPath(fileKey)
    ?? `gs://${config.gcsBucket ?? ''}/${fileKey}`;

  return {
    fileKey,
    filePath,
    originalFilename: upload.originalFilename,
    fileType: upload.fileType,
    fileHash: upload.fileHash,
  };
}
