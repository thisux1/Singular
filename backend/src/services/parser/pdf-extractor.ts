// @ts-nocheck
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Setup worker
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
pdfjsLib.GlobalWorkerOptions.workerSrc = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

export interface PdfFragment {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  page: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfPageInfo {
  page: number;
  pageWidth: number;
  pageHeight: number;
  hasImages: boolean;
  fragmentCount: number;
}

export interface PdfExtractResult {
  fragments: PdfFragment[];
  pageInfo: PdfPageInfo[];
  metadata: {
    title: string;
    author: string;
    creator: string;
    numPages: number;
  };
}

interface ExtractPdfFragmentsOptions {
  pageStart?: number;
  pageEnd?: number;
}

function normalizePageRange(numPages: number, pageStart?: number, pageEnd?: number): [number, number] {
  const start = Number.isInteger(pageStart) && (pageStart as number) > 0 ? (pageStart as number) : 1;
  const end = Number.isInteger(pageEnd) && (pageEnd as number) > 0 ? (pageEnd as number) : numPages;
  const boundedStart = Math.min(start, numPages);
  const boundedEnd = Math.min(end, numPages);

  if (boundedEnd < boundedStart) {
    return [boundedStart, boundedStart];
  }

  return [boundedStart, boundedEnd];
}

export async function extractPdfFragments(
  fileBuffer: Buffer | ArrayBuffer | Uint8Array,
  onProgress?: (currentPage: number, totalPages: number) => void,
  options?: ExtractPdfFragmentsOptions,
): Promise<PdfExtractResult> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(fileBuffer),
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const allFragments: PdfFragment[] = [];
  const pageInfo: PdfPageInfo[] = [];

  const [startPage, endPage] = normalizePageRange(numPages, options?.pageStart, options?.pageEnd);
  const totalPagesInRange = endPage - startPage + 1;

  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    if (onProgress) onProgress(pageNum - startPage + 1, totalPagesInRange);

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    // --- Extract text fragments ---
    const textContent = await page.getTextContent();
    const pageFragments: PdfFragment[] = textContent.items
      .filter((item: any) => item.str && item.str.trim().length > 0)
      .map((item: any) => {
        // transform[4] = x, transform[5] = y (bottom-left origin in PDF space)
        const x = item.transform[4];
        const yPdf = item.transform[5];
        // Convert to top-left origin
        const y = pageHeight - yPdf;
        const fontSize = Math.abs(item.transform[3]);

        return {
          str: item.str,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          width: Math.round((item.width || 0) * 10) / 10,
          height: Math.round((item.height || fontSize) * 10) / 10,
          fontSize: Math.round(fontSize * 10) / 10,
          page: pageNum,
          pageWidth,
          pageHeight,
        };
      });

    // --- Detect images on this page ---
    let hasImages = false;
    try {
      const opList = await page.getOperatorList();
      const imageOps = [
        pdfjsLib.OPS.paintImageXObject,
        pdfjsLib.OPS.paintInlineImageXObject,
        pdfjsLib.OPS.paintImageMaskXObject,
      ].filter(Boolean);
      hasImages = opList.fnArray.some((op: any) => imageOps.includes(op));
    } catch (_) {
      // Ignored
    }

    pageInfo.push({
      page: pageNum,
      pageWidth,
      pageHeight,
      hasImages,
      fragmentCount: pageFragments.length
    });
    allFragments.push(...pageFragments);
  }

  // Extract basic metadata
  let metadataObj = { title: '', author: '', creator: '', numPages };
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as any;
    if (info) {
      metadataObj.title = info.Title || '';
      metadataObj.author = info.Author || '';
      metadataObj.creator = info.Creator || '';
    }
  } catch (_) {}

  return { fragments: allFragments, pageInfo, metadata: metadataObj };
}

