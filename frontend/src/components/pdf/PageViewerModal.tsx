import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderTask } from 'pdfjs-dist';
import { Modal } from '../ui/Modal';
import { getExamPdfDocument } from './pdfDocumentCache';
import './PageViewerModal.css';

type PageViewerModalProps = {
  open: boolean;
  onClose: () => void;
  examId: string;
  /** Página 1-based no PDF original. */
  page: number;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

/**
 * Modal que renderiza uma página do PDF original via pdfjs.
 * `zoom = null` → fit-width (escala calculada a partir do container).
 */
export function PageViewerModal({ open, onClose, examId, page }: PageViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit-width
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [resolvedPage, setResolvedPage] = useState(page);

  const renderPage = useCallback(async () => {
    const canvas = canvasRef.current;
    const container = viewportRef.current;
    if (!canvas || !container || !open) {
      return;
    }

    setStatus('loading');
    setErrorMessage(null);

    try {
      const doc = await getExamPdfDocument(examId);
      const totalPages = doc.numPages;
      setPageCount(totalPages);

      const target = Math.min(Math.max(page, 1), totalPages);
      setResolvedPage(target);

      const pdfPage = await doc.getPage(target);
      const baseViewport = pdfPage.getViewport({ scale: 1 });

      // fit-width quando zoom não foi ajustado manualmente
      const containerWidth = Math.max(container.clientWidth - 32, 200);
      const cssScale = zoom ?? containerWidth / baseViewport.width;
      const dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: cssScale * dpr });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
      canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas 2D indisponível');
      }

      // Cancela render anterior em voo antes de iniciar outro.
      renderTaskRef.current?.cancel();
      // pdfjs v6: `canvas` é obrigatório (canvasContext virou legado).
      const task = pdfPage.render({ canvas, canvasContext: context, viewport });
      renderTaskRef.current = task;

      await task.promise;
      setStatus('ready');
    } catch (error) {
      if (error instanceof Error && error.name === 'RenderingCancelledException') {
        return;
      }

      setStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível renderizar a página.',
      );
    }
  }, [open, examId, page, zoom]);

  useEffect(() => {
    if (open) {
      void renderPage();
    }
  }, [open, renderPage]);

  // Cleanup: cancela o render task ao fechar/desmontar.
  useEffect(() => {
    if (!open) {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      setZoom(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
    };
  }, []);

  const zoomPercent = status === 'ready' && zoom !== null ? Math.round(zoom * 100) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      title={`Página ${resolvedPage}${pageCount ? ` de ${pageCount}` : ''}`}
      description="Original do documento enviado"
    >
      <div className="page-viewer">
        <div className="page-viewer__toolbar">
          <button
            type="button"
            className="page-viewer__tool icon-btn"
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, (value ?? 1) - ZOOM_STEP))}
            aria-label="Reduzir zoom"
          >
            −
          </button>
          <span className="page-viewer__zoom-label text-mono" aria-live="polite">
            {zoomPercent !== null ? `${zoomPercent}%` : 'auto'}
          </span>
          <button
            type="button"
            className="page-viewer__tool icon-btn"
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, (value ?? 1) + ZOOM_STEP))}
            aria-label="Aumentar zoom"
          >
            +
          </button>
          <button
            type="button"
            className="page-viewer__tool page-viewer__tool--fit icon-btn"
            onClick={() => setZoom(null)}
            disabled={zoom === null}
          >
            Ajustar à largura
          </button>
        </div>

        <div className="page-viewer__viewport" ref={viewportRef}>
          {status === 'loading' ? (
            <div className="page-viewer__state empty" role="status">
              Renderizando página…
            </div>
          ) : null}
          {status === 'error' ? (
            <div className="page-viewer__state page-viewer__state--error empty" role="alert">
              {errorMessage ?? 'Falha ao carregar a página.'}
              <button type="button" className="page-viewer__tool icon-btn" onClick={() => void renderPage()}>
                Tentar novamente
              </button>
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            className="page-viewer__canvas"
            style={{ display: status === 'ready' ? 'block' : 'none' }}
          />
        </div>
      </div>
    </Modal>
  );
}
