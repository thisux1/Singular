"""OCR provider abstraction for local (Ollama) and API (Gemini) modes.

Provider is selected via the OCR_PROVIDER environment variable:
  - "local" → Ollama-served VLMs (GLM-OCR, Qwen2.5-VL, ...) — cost: $0
  - "api"   → Gemini Flash via Google GenAI SDK — cost: ~$0.001/page

Environment variables:
  OCR_PROVIDER              provider selection (default: "local")
  OLLAMA_BASE_URL           Ollama server (default: http://localhost:11434)
  OLLAMA_OCR_MODEL          primary model (default: glm-ocr)
  OLLAMA_OCR_FALLBACK_MODEL secondary model; enables the fallback provider
  OLLAMA_NUM_CTX            context window (default: 16384)
  PIPELINE_GEMINI_MODEL     Gemini OCR model (default: gemini-2.5-flash)
  PDF_DPI                   PDF rasterization DPI (default: 150)
  GEMINI_API_KEY / GOOGLE_API_KEY

Per-page OCR calls retry with backoff (delays 2s/4s/8s). A page that still
fails is recorded in OCRResult.page_errors — never silently dropped.
"""

from __future__ import annotations

import base64
import contextlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator


RETRY_DELAYS = (2.0, 4.0, 8.0)  # seconds; attempts == len(RETRY_DELAYS)


def _log_stderr(msg: str) -> None:
    """Log to stderr so stdout stays pure JSON for the pipeline contract."""
    sys.stderr.write(f"[ocr_provider] {msg}\n")
    sys.stderr.flush()


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _with_retry(fn: Callable[[], str], label: str) -> str:
    """Call fn with retry/backoff; raises after exhausting RETRY_DELAYS attempts."""
    last_exc: Exception | None = None
    attempts = len(RETRY_DELAYS)
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            _log_stderr(f"  {label}: attempt {attempt + 1}/{attempts} failed: {exc}")
            if attempt + 1 < attempts:
                time.sleep(RETRY_DELAYS[attempt])
    raise last_exc  # type: ignore[misc]


@dataclass
class OCRResult:
    text: str
    confidence: float
    page_errors: list[dict] = field(default_factory=list)  # {"page": int, "error": str}
    pages_processed: int = 0
    pages_failed: int = 0


@contextlib.contextmanager
def _pdf_to_images(
    file_path: str,
    dpi: int | None = None,
    first_page: int | None = None,
    last_page: int | None = None,
) -> Iterator[list[str]]:
    """Convert PDF pages to PNGs in a temp dir; yields paths; cleans up on exit."""
    if dpi is None:
        dpi = int(os.getenv("PDF_DPI", "150"))
    try:
        from pdf2image import convert_from_path  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "pdf2image is required for local OCR of PDFs. "
            "Install with: pip install pdf2image"
        ) from exc

    convert_kwargs = {"dpi": dpi}
    if first_page is not None:
        convert_kwargs["first_page"] = first_page
    if last_page is not None:
        convert_kwargs["last_page"] = last_page

    images = convert_from_path(file_path, **convert_kwargs)
    with tempfile.TemporaryDirectory(prefix="singular_ocr_") as tmp_dir:
        paths: list[str] = []
        for i, img in enumerate(images):
            p = os.path.join(tmp_dir, f"page_{i:03d}.png")
            img.save(p, "PNG")
            paths.append(p)
        _log_stderr(f"Converted {len(paths)} pages from PDF to images (dpi={dpi})")
        yield paths


def _image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _extract_pdf_text_pymupdf(
    file_path: str,
    page_start: int | None,
    page_end: int | None,
) -> tuple[str, int] | None:
    """Direct text extraction for PDFs with a selectable text layer.

    Returns (text_with_page_markers, page_count) or None when text is
    insufficient (< 100 normalized chars), signalling VLM OCR is needed.
    """
    import fitz  # type: ignore  # PyMuPDF

    doc = fitz.open(file_path)
    try:
        start_index = max((page_start or 1) - 1, 0)
        end_index = min((page_end or len(doc)), len(doc))
        if start_index >= end_index:
            return None
        pages_text = [doc[i].get_text() for i in range(start_index, end_index)]
    finally:
        doc.close()
    combined = "\n\n".join(pages_text)
    if len(_normalize_whitespace(combined)) < 100:
        return None
    marked = "\n\n---\n\n".join(
        f"[Página {start_index + 1 + i}]\n{t}" for i, t in enumerate(pages_text)
    )
    return marked, end_index - start_index


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class OCRProvider(ABC):
    """Base class for OCR providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> OCRResult:
        ...


# ---------------------------------------------------------------------------
# Ollama-based local OCR (GLM-OCR / Qwen2.5-VL)
# ---------------------------------------------------------------------------


class OllamaOCRProvider(OCRProvider):
    """Local OCR via Ollama-served VLMs (GLM-OCR, Qwen2.5-VL, etc)."""

    def __init__(self) -> None:
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_OCR_MODEL", "glm-ocr")
        self.num_ctx = int(os.getenv("OLLAMA_NUM_CTX", "16384"))

    @property
    def name(self) -> str:
        return f"ollama-{self.model}"

    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> OCRResult:
        _log_stderr(f"Ollama OCR: model={self.model}, file={file_path}")

        if file_path.lower().endswith(".pdf"):
            try:
                _log_stderr("Attempting direct text extraction via PyMuPDF...")
                direct = _extract_pdf_text_pymupdf(file_path, page_start, page_end)
                if direct is not None:
                    text, n_pages = direct
                    _log_stderr(f"Direct text extraction successful! Extracted {len(text)} chars.")
                    return OCRResult(text=text, confidence=1.0, pages_processed=n_pages)
                _log_stderr("Direct text extraction returned insufficient text. Falling back to VLM OCR.")
            except Exception as exc:
                _log_stderr(f"Direct text extraction failed/skipped: {exc}. Falling back to VLM OCR.")

            with _pdf_to_images(file_path, first_page=page_start, last_page=page_end) as image_paths:
                return self._ocr_images(image_paths, page_start)

        return self._ocr_images([file_path], page_start)

    def _ocr_images(self, image_paths: list[str], page_start: int | None) -> OCRResult:
        base_page = page_start or 1
        all_text: list[str] = []
        page_errors: list[dict] = []

        for i, img_path in enumerate(image_paths):
            page_no = base_page + i
            _log_stderr(f"  Processing page {page_no} ({i + 1}/{len(image_paths)})...")
            try:
                page_text = _with_retry(
                    lambda p=img_path: self._process_single_image(p),
                    label=f"page {page_no}",
                )
            except Exception as exc:
                page_errors.append({"page": page_no, "error": str(exc)})
                continue
            if page_text.strip():
                all_text.append(f"[Página {page_no}]\n{page_text}")

        full_text = "\n\n---\n\n".join(all_text)

        # Heuristic confidence: ~500 chars/page is a reasonable minimum.
        expected_chars = len(image_paths) * 500
        confidence = min(len(full_text) / max(expected_chars, 1), 1.0)

        _log_stderr(
            f"Ollama OCR complete: {len(full_text)} chars, "
            f"confidence={confidence:.2f}, pages={len(image_paths)}, "
            f"failed={len(page_errors)}"
        )
        return OCRResult(
            text=full_text,
            confidence=confidence,
            page_errors=page_errors,
            pages_processed=len(image_paths) - len(page_errors),
            pages_failed=len(page_errors),
        )

    def _process_single_image(self, image_path: str) -> str:
        """Send a single image to Ollama for OCR. Raises on transport errors."""
        img_b64 = _image_to_base64(image_path)

        request_body = json.dumps({
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Extraia TODO o texto deste documento de prova/exame. "
                        "Preserve a numeração das questões e alternativas (A, B, C, D, E). "
                        "Mantenha a estrutura original. "
                        "Retorne em Markdown."
                    ),
                    "images": [img_b64],
                }
            ],
            "options": {"num_ctx": self.num_ctx},
            "stream": False,
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("message", {}).get("content", "")


# ---------------------------------------------------------------------------
# Ollama fallback provider (secondary local model)
# ---------------------------------------------------------------------------


class OllamaFallbackOCRProvider(OllamaOCRProvider):
    """Fallback local OCR using a secondary Ollama model
    (OLLAMA_OCR_FALLBACK_MODEL, default: qwen2.5vl:3b)."""

    def __init__(self) -> None:
        super().__init__()
        self.model = os.getenv("OLLAMA_OCR_FALLBACK_MODEL", "qwen2.5vl:3b")


# ---------------------------------------------------------------------------
# Gemini Flash API provider
# ---------------------------------------------------------------------------


class GeminiOCRProvider(OCRProvider):
    """OCR via Gemini Flash API (Google GenAI SDK)."""

    def __init__(self, api_key: str | None = None) -> None:
        self.model = os.getenv("PIPELINE_GEMINI_MODEL", "gemini-2.5-flash")
        self.api_key = api_key
        self._client = None

    @property
    def name(self) -> str:
        return "gemini"

    def _get_client(self):
        if self._client is None:
            from google import genai  # type: ignore

            api_key = self.api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
            if not api_key:
                raise RuntimeError("GEMINI_API_KEY_NOT_CONFIGURED")
            self._client = genai.Client(api_key=api_key)
        return self._client

    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> OCRResult:
        try:
            from google import genai  # type: ignore  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(f"GOOGLE_GENAI_IMPORT_ERROR:{exc}") from exc

        _log_stderr(f"Gemini OCR: model={self.model}, file={file_path}")

        if Path(file_path).suffix.lower() == ".pdf":
            result = self._extract_from_pdf(file_path, page_start, page_end)
        else:
            result = self._ocr_images([file_path], page_start)

        _log_stderr(
            f"Gemini OCR complete: {len(result.text)} chars, "
            f"confidence={result.confidence:.2f}, failed={result.pages_failed}"
        )
        return result

    def _extract_from_pdf(self, file_path: str, page_start: int | None, page_end: int | None) -> OCRResult:
        try:
            direct = _extract_pdf_text_pymupdf(file_path, page_start, page_end)
            if direct is not None:
                text, n_pages = direct
                confidence = min(len(text) / 500, 1.0)
                return OCRResult(text=text, confidence=confidence, pages_processed=n_pages)
        except Exception as exc:
            _log_stderr(f"Direct text extraction failed/skipped: {exc}. Falling back to Gemini vision OCR.")

        with _pdf_to_images(file_path, first_page=page_start, last_page=page_end) as image_paths:
            return self._ocr_images(image_paths, page_start)

    def _ocr_images(self, image_paths: list[str], page_start: int | None) -> OCRResult:
        base_page = page_start or 1
        all_text: list[str] = []
        page_errors: list[dict] = []

        for i, img_path in enumerate(image_paths):
            page_no = base_page + i
            try:
                page_text = _with_retry(
                    lambda p=img_path: self._extract_from_image(p),
                    label=f"page {page_no}",
                )
            except Exception as exc:
                page_errors.append({"page": page_no, "error": str(exc)})
                continue
            if page_text.strip():
                all_text.append(f"[Página {page_no}]\n{page_text}")

        full_text = "\n\n---\n\n".join(all_text)
        confidence = min(len(full_text) / 500, 1.0) if full_text else 0.0
        return OCRResult(
            text=full_text,
            confidence=confidence,
            page_errors=page_errors,
            pages_processed=len(image_paths) - len(page_errors),
            pages_failed=len(page_errors),
        )

    def _extract_from_image(self, image_path: str) -> str:
        """Send a single image to Gemini. Raises on API errors."""
        img_b64 = _image_to_base64(image_path)

        response = self._get_client().models.generate_content(
            model=self.model,
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"text": (
                            "Extraia TODO o texto deste documento de prova. "
                            "Preserve numeração de questões e alternativas. "
                            "Retorne em Markdown."
                        )},
                        {"inline_data": {
                            "mime_type": "image/png",
                            "data": img_b64,
                        }},
                    ],
                }
            ],
        )
        return getattr(response, "text", "") or ""


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_ocr_provider(
    provider_name: str | None = None, api_key: str | None = None
) -> OCRProvider:
    """Create an OCR provider: "local" (Ollama) or "api" (Gemini).

    Raises ValueError for unknown values — fail explicit, never silent default.
    """
    name = provider_name or os.getenv("OCR_PROVIDER", "local")

    if name == "local":
        return OllamaOCRProvider()
    elif name == "api":
        return GeminiOCRProvider(api_key=api_key)
    else:
        raise ValueError(f"Unknown OCR_PROVIDER='{name}'. Valid: local, api")


def create_ocr_fallback_provider() -> OCRProvider | None:
    """Create a fallback OCR provider for local mode.

    Returns None unless OCR_PROVIDER == "local" and OLLAMA_OCR_FALLBACK_MODEL
    is configured.
    """
    provider = os.getenv("OCR_PROVIDER", "local")
    fallback_model = os.getenv("OLLAMA_OCR_FALLBACK_MODEL")

    if provider == "local" and fallback_model:
        return OllamaFallbackOCRProvider()

    return None
