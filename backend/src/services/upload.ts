import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export interface SavedUpload {
  filePath: string;
  originalFilename: string;
  fileType: 'pdf' | 'image';
}

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

function normalizeFileType(contentType: string): 'pdf' | 'image' {
  return contentType === 'application/pdf' ? 'pdf' : 'image';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function validateUploadFile(file: File): void {
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new Error('INVALID_FILE_TYPE');
  }

  if (file.size <= 0 || file.size > config.maxUploadSizeBytes) {
    throw new Error('INVALID_FILE_SIZE');
  }
}

export async function saveUpload(file: File): Promise<SavedUpload> {
  await mkdir(config.uploadDir, { recursive: true });

  const ext = path.extname(file.name) || (file.type === 'application/pdf' ? '.pdf' : '.bin');
  const safeBaseName = sanitizeFilename(path.basename(file.name, ext));
  const filename = `${Date.now()}-${randomUUID()}-${safeBaseName}${ext}`;
  const destination = path.join(config.uploadDir, filename);

  const arrayBuffer = await file.arrayBuffer();
  await writeFile(destination, Buffer.from(arrayBuffer));

  return {
    filePath: destination,
    originalFilename: file.name,
    fileType: normalizeFileType(file.type),
  };
}
