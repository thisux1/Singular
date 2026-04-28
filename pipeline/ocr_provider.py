"""OCR provider abstraction for local (Ollama) and API (Gemini) modes.

Controls which OCR engine is used via the OCR_PROVIDER environment variable:
  - "local"  → Ollama with GLM-OCR / Qwen2.5-VL (cost: $0)
  - "api"    → Gemini Flash via Google GenAI SDK (cost: ~$0.001/page)
  - "docling" → Docling only, no VLM (legacy default)

Usage:
    provider = create_ocr_provider()
    text, confidence, provider_name = provider.extract_text(file_path)
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Literal


def _log_stderr(msg: str) -> None:
    """Log to stderr so stdout stays pure JSON for the pipeline contract."""
    sys.stderr.write(f"[ocr_provider] {msg}\n")
    sys.stderr.flush()


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _pdf_to_images(
    file_path: str,
    dpi: int | None = None,
    first_page: int | None = None,
    last_page: int | None = None,
) -> list[str]:
    """Convert PDF pages to temporary PNG images. Returns list of file paths."""
    if dpi is None:
        dpi = int(os.getenv("PDF_DPI", "50"))
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
    paths: list[str] = []
    tmp_dir = tempfile.mkdtemp(prefix="quizsaber_ocr_")
    for i, img in enumerate(images):
        p = os.path.join(tmp_dir, f"page_{i:03d}.png")
        img.save(p, "PNG")
        paths.append(p)

    _log_stderr(f"Converted {len(paths)} pages from PDF to images (dpi={dpi})")
    return paths


def _image_to_base64(image_path: str) -> str:
    """Read image file and return base64-encoded string."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


OCRProviderName = Literal["ollama-glm-ocr", "ollama-qwen-vl", "gemini", "docling"]


class OCRProvider(ABC):
    """Base class for OCR providers."""

    @property
    @abstractmethod
    def name(self) -> OCRProviderName:
        ...

    @abstractmethod
    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> tuple[str, float]:
        """Extract text from a document file.

        Returns:
            (extracted_text, confidence_score)
            confidence_score is a float between 0 and 1.
        """
        ...


# ---------------------------------------------------------------------------
# Ollama-based local OCR (GLM-OCR / Qwen2.5-VL)
# ---------------------------------------------------------------------------


class OllamaOCRProvider(OCRProvider):
    """Local OCR via Ollama-served VLMs (GLM-OCR, Qwen2.5-VL, etc).

    Environment variables:
        OLLAMA_BASE_URL    — Ollama server URL (default: http://localhost:11434)
        OLLAMA_OCR_MODEL   — Primary model (default: glm-ocr)
        OLLAMA_NUM_CTX     — Context window (default: 16384, required for images)
    """

    def __init__(self) -> None:
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_OCR_MODEL", "glm-ocr")
        self.num_ctx = int(os.getenv("OLLAMA_NUM_CTX", "16384"))

    @property
    def name(self) -> OCRProviderName:
        model = self.model.lower()
        if "qwen" in model:
            return "ollama-qwen-vl"
        return "ollama-glm-ocr"

    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> tuple[str, float]:
        _log_stderr(f"Ollama OCR: model={self.model}, file={file_path}")

        # Prepare images from input file
        if file_path.lower().endswith(".pdf"):
            image_paths = _pdf_to_images(
                file_path,
                first_page=page_start,
                last_page=page_end,
            )
        else:
            image_paths = [file_path]

        all_text: list[str] = []

        for i, img_path in enumerate(image_paths):
            _log_stderr(f"  Processing page {i + 1}/{len(image_paths)}...")
            page_text = self._process_single_image(img_path)
            if page_text.strip():
                all_text.append(page_text)

        full_text = "\n\n---\n\n".join(all_text)

        # Simple heuristic confidence based on text length
        # ~500 chars per page is a reasonable minimum for a useful extraction
        expected_chars = len(image_paths) * 500
        confidence = min(len(full_text) / max(expected_chars, 1), 1.0)

        _log_stderr(
            f"Ollama OCR complete: {len(full_text)} chars, "
            f"confidence={confidence:.2f}, pages={len(image_paths)}"
        )
        return full_text, confidence

    def _process_single_image(self, image_path: str) -> str:
        """Send a single image to Ollama for OCR."""
        import urllib.request

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

        url = f"{self.base_url}/api/chat"
        req = urllib.request.Request(
            url,
            data=request_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("message", {}).get("content", "")
        except Exception as exc:
            _log_stderr(f"  Ollama error: {exc}")
            return ""


# ---------------------------------------------------------------------------
# Ollama fallback provider (secondary local model)
# ---------------------------------------------------------------------------


class OllamaFallbackOCRProvider(OllamaOCRProvider):
    """Fallback local OCR using a secondary Ollama model.

    Environment variables:
        OLLAMA_OCR_FALLBACK_MODEL — Fallback model (default: qwen2.5vl:3b)
    """

    def __init__(self) -> None:
        super().__init__()
        self.model = os.getenv("OLLAMA_OCR_FALLBACK_MODEL", "qwen2.5vl:3b")

    @property
    def name(self) -> OCRProviderName:
        return "ollama-qwen-vl"


# ---------------------------------------------------------------------------
# Gemini Flash API provider
# ---------------------------------------------------------------------------


class GeminiOCRProvider(OCRProvider):
    """OCR via Gemini Flash API (Google GenAI SDK)."""

    def __init__(self, api_key: str | None = None) -> None:
        self.model = os.getenv("PIPELINE_GEMINI_MODEL", "gemini-2.5-flash")
        self.api_key = api_key

    @property
    def name(self) -> OCRProviderName:
        return "gemini"

    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> tuple[str, float]:
        api_key = self.api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY_NOT_CONFIGURED")

        try:
            from google import genai  # type: ignore
        except ImportError as exc:
            raise RuntimeError(f"GOOGLE_GENAI_IMPORT_ERROR:{exc}") from exc

        _log_stderr(f"Gemini OCR: model={self.model}, file={file_path}")

        # For PDFs, read the file and send as document
        # For images, send as image
        file_path_obj = Path(file_path)

        if file_path_obj.suffix.lower() == ".pdf":
            text = self._extract_from_pdf_text(
                file_path,
                api_key,
                page_start=page_start,
                page_end=page_end,
            )
        else:
            text = self._extract_from_image(file_path, api_key)

        confidence = min(len(text) / 500, 1.0) if text else 0.0
        _log_stderr(f"Gemini OCR complete: {len(text)} chars, confidence={confidence:.2f}")
        return text, confidence

    def _extract_from_pdf_text(
        self,
        file_path: str,
        api_key: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> str:
        """Extract text by first trying PyMuPDF, then sending to Gemini."""
        # Try direct text extraction first
        try:
            import fitz  # type: ignore  # PyMuPDF

            doc = fitz.open(file_path)
            start_index = max((page_start or 1) - 1, 0)
            end_index = min((page_end or len(doc)), len(doc))
            pages_text = [doc[i].get_text() for i in range(start_index, end_index)]
            doc.close()
            combined = "\n\n".join(pages_text)
            if len(_normalize_whitespace(combined)) > 100:
                return combined
        except Exception:
            pass

        # Fall back to Gemini multimodal with page images
        image_paths = _pdf_to_images(
            file_path,
            first_page=page_start,
            last_page=page_end,
        )
        all_text = []
        for img_path in image_paths:
            text = self._extract_from_image(img_path, api_key)
            if text:
                all_text.append(text)
        return "\n\n".join(all_text)

    def _extract_from_image(self, image_path: str, api_key: str) -> str:
        from google import genai  # type: ignore

        img_b64 = _image_to_base64(image_path)

        response = genai.Client(api_key=api_key).models.generate_content(
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
# Docling provider (legacy, non-VLM)
# ---------------------------------------------------------------------------


class DoclingOCRProvider(OCRProvider):
    """OCR via Docling (IBM) — Python library, no GPU needed."""

    @property
    def name(self) -> OCRProviderName:
        return "docling"

    def extract_text(
        self,
        file_path: str,
        page_start: int | None = None,
        page_end: int | None = None,
    ) -> tuple[str, float]:
        try:
            from docling.document_converter import DocumentConverter  # type: ignore
        except ImportError as exc:
            _log_stderr(f"Docling import error: {exc}")
            return "", 0.0

        try:
            _log_stderr(f"Docling OCR: file={file_path}")
            converter = DocumentConverter()
            result = converter.convert(file_path)
            markdown = result.document.export_to_markdown()
            text = _normalize_whitespace(markdown)

            if page_start is not None or page_end is not None:
                page_blocks = [block.strip() for block in text.split("\f") if block.strip()]
                if page_blocks:
                    start_index = max((page_start or 1) - 1, 0)
                    end_index = min((page_end or len(page_blocks)), len(page_blocks))
                    text = "\n\n".join(page_blocks[start_index:end_index])

            confidence = min(len(text) / 500, 1.0) if text else 0.0
            _log_stderr(f"Docling OCR complete: {len(text)} chars, confidence={confidence:.2f}")
            return text, confidence
        except Exception as exc:
            _log_stderr(f"Docling convert error: {exc}")
            return "", 0.0


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_ocr_provider(
    provider_name: str | None = None, api_key: str | None = None
) -> OCRProvider:
    """Create an OCR provider based on OCR_PROVIDER env var or explicit name.

    Values:
        "local"   — Ollama with primary model (GLM-OCR by default)
        "api"     — Gemini Flash via API
        "docling" — Docling library (legacy)
    """
    name = provider_name or os.getenv("OCR_PROVIDER", "docling")

    if name == "local":
        return OllamaOCRProvider()
    elif name == "api":
        return GeminiOCRProvider(api_key=api_key)
    elif name == "docling":
        return DoclingOCRProvider()
    else:
        raise ValueError(
            f"Unknown OCR_PROVIDER='{name}'. Valid: local, api, docling"
        )


def create_ocr_fallback_provider() -> OCRProvider | None:
    """Create a fallback OCR provider for local mode.

    Returns None if OCR_PROVIDER is not 'local' or no fallback model is configured.
    """
    provider = os.getenv("OCR_PROVIDER", "docling")
    fallback_model = os.getenv("OLLAMA_OCR_FALLBACK_MODEL")

    if provider == "local" and fallback_model:
        return OllamaFallbackOCRProvider()

    return None
