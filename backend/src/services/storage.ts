import { Storage } from '@google-cloud/storage';
import { createReadStream as fsCreateReadStream } from 'node:fs';
import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

/**
 * Storage abstraction (D4).
 *
 * - `gcs`: ativado quando `GCS_BUCKET` está setado — usa ADC default
 *   (sem key file em dev; em Cloud Run usa a service account do service).
 * - `local`: default dev — escreve sob `config.uploadDir` (absoluto via config).
 *
 * Keys seguem o layout `exams/<user_id>/<exam_id>/<arquivo>` (BACKEND-SCHEMA §4).
 * `resolveLocalPath` existe para o worker ler o arquivo em dev; retorna
 * `null` no driver GCS (worker em prod resolve via GCS, fora deste escopo).
 */
export interface StorageDriver {
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  /** GCS → signed URL v4 com TTL 15min; local → null (caller usa stream). */
  getReadUrl(key: string): Promise<string | null>;
  createReadStream(key: string): Readable;
  delete(key: string): Promise<void>;
  /** Caminho local absoluto da key (driver local); null no GCS. */
  resolveLocalPath(key: string): string | null;
}

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Content-Type por extensão da key; fallback octet-stream. */
export function mimeForKey(key: string): string {
  return MIME_BY_EXT[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Driver local (dev/self-host)
// ---------------------------------------------------------------------------

const localBaseDir = path.resolve(config.uploadDir);

function resolveKeySafe(key: string): string {
  // path.normalize elimina '..'/'//'; prefix check garante que a key não
  // escape do uploadDir (anti-traversal).
  const resolved = path.resolve(localBaseDir, path.normalize(key));
  if (resolved !== localBaseDir && !resolved.startsWith(localBaseDir + path.sep)) {
    throw new Error(`STORAGE_PATH_TRAVERSAL:${key}`);
  }
  return resolved;
}

const localDriver: StorageDriver = {
  async put(key, buffer) {
    const destination = resolveKeySafe(key);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buffer);
  },

  async getReadUrl() {
    return null;
  },

  createReadStream(key) {
    return fsCreateReadStream(resolveKeySafe(key));
  },

  async delete(key) {
    const resolved = resolveKeySafe(key);
    try {
      await unlink(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Best-effort: remove o diretório-pai se ficou vazio (ex.: exams/<u>/<id>/).
    const parentDir = path.dirname(resolved);
    if (parentDir !== localBaseDir && parentDir.startsWith(localBaseDir + path.sep)) {
      await rmdir(parentDir).catch(() => undefined);
    }
  },

  resolveLocalPath(key) {
    return resolveKeySafe(key);
  },
};

/**
 * Remove arquivo legado referenciado por `filePath` absoluto (linhas antigas
 * sem fileKey). Recusa caminhos fora do uploadDir — nunca deleta arbitrário.
 * No-op quando o driver ativo é GCS.
 */
async function deleteLegacyLocalPath(absolutePath: string): Promise<void> {
  if (config.gcsBucket) {
    return;
  }

  const resolved = path.resolve(absolutePath);
  if (!resolved.startsWith(localBaseDir + path.sep)) {
    return;
  }
  try {
    await unlink(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Driver GCS
// ---------------------------------------------------------------------------

function createGcsDriver(bucketName: string): StorageDriver {
  const gcs = new Storage();
  const bucket = gcs.bucket(bucketName);

  return {
    async put(key, buffer, contentType) {
      await bucket.file(key).save(buffer, {
        contentType,
        resumable: false,
        metadata: { contentType },
      });
    },

    async getReadUrl(key) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
      return url;
    },

    createReadStream(key) {
      return bucket.file(key).createReadStream();
    },

    async delete(key) {
      try {
        await bucket.file(key).delete({ ignoreNotFound: true });
      } catch (error) {
        // ignoreNotFound cobre 404; demais erros propagam.
        if ((error as { code?: number }).code === 404) {
          return;
        }
        throw error;
      }
    },

    resolveLocalPath() {
      return null;
    },
  };
}

const driver: StorageDriver = config.gcsBucket
  ? createGcsDriver(config.gcsBucket)
  : localDriver;

export const storageKind: 'gcs' | 'local' = config.gcsBucket ? 'gcs' : 'local';

export const storage = {
  kind: storageKind,
  put: driver.put,
  getReadUrl: driver.getReadUrl,
  createReadStream: driver.createReadStream,
  delete: driver.delete,
  resolveLocalPath: driver.resolveLocalPath,
  deleteLegacyLocalPath,
};
