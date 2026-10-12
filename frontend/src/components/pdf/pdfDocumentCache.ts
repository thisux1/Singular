import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fetchExamFileData } from '../../api/exams';

// Worker bundlado pelo Vite via ?url — evita CDN e respeita CSP local.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const documentCache = new Map<string, Promise<PDFDocumentProxy>>();

/**
 * PDFDocument por exame (memo em módulo — sobrevive a re-renders e
 * reaberturas do modal na mesma sessão de página). Falhas são removidas
 * do cache para permitir retry.
 */
export function getExamPdfDocument(examId: string): Promise<PDFDocumentProxy> {
  const cached = documentCache.get(examId);
  if (cached) {
    return cached;
  }

  const promise = fetchExamFileData(examId)
    .then((data) => getDocument({ data }).promise)
    .catch((error) => {
      documentCache.delete(examId);
      throw error;
    });

  documentCache.set(examId, promise);
  return promise;
}
