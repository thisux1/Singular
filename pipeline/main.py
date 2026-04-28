#!/usr/bin/env python3
"""Fallback OCR/IA pipeline entrypoint.

Contract:
- Reads JSON payload from stdin.
- Writes JSON result to stdout.
- Never writes non-JSON to stdout.

OCR Provider:
- Controlled by OCR_PROVIDER env var: "local" | "api" | "docling"
- "local" uses Ollama (GLM-OCR / Qwen2.5-VL) — cost $0
- "api" uses Gemini Flash — cost ~$0.001/page
- "docling" uses Docling library — cost $0 (legacy default)
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from ocr_provider import (
    create_ocr_provider,
    create_ocr_fallback_provider,
    _log_stderr,
)


class PipelineInput(BaseModel):
    exam_id: str = Field(min_length=1)
    file_path: str = Field(min_length=1)
    fallback_reason: str = Field(min_length=1)
    extract_min_chars: int = Field(default=180, ge=1)
    gemini_model: str = Field(default="gemini-2.5-flash", min_length=1)
    gemini_api_key: str | None = None
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    prova_type: str | None = None

    def model_post_init(self, __context) -> None:
        if (
            self.page_start is not None
            and self.page_end is not None
            and self.page_end < self.page_start
        ):
            raise ValueError("page_end must be greater than or equal to page_start")



class Question(BaseModel):
    order: int = Field(ge=1)
    questionText: str = Field(min_length=1)
    options: list[str] = Field(default_factory=list)


class QuestionsPayload(BaseModel):
    questions: list[Question] = Field(min_length=1)


class PipelineSuccessResult(BaseModel):
    status: Literal["ok"]
    usedPath: str  # Now accepts any provider name
    fallbackTriggered: bool
    fallbackReason: str | None = None
    totalQuestions: int = Field(ge=1)
    questions: list[Question] = Field(min_length=1)
    extractionChars: int = Field(ge=0)


class PipelineErrorResult(BaseModel):
    status: Literal["error"]
    errorCode: str
    message: str


def emit(result: PipelineSuccessResult | PipelineErrorResult) -> None:
    sys.stdout.write(result.model_dump_json())
    sys.stdout.flush()


def emit_error(error_code: str, message: str) -> None:
    emit(
        PipelineErrorResult(
            status="error",
            errorCode=error_code,
            message=message,
        )
    )


def read_input() -> PipelineInput:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("stdin payload is empty")
    return PipelineInput.model_validate_json(raw)





def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def gemini_extract_questions(payload: PipelineInput, source_text: str) -> QuestionsPayload:
    """Use Gemini API with Instructor to extract structured questions from raw text."""

    api_key = payload.gemini_api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY_NOT_CONFIGURED")

    try:
        from google import genai  # type: ignore
        import instructor
    except ImportError as exc:
        raise RuntimeError(f"IMPORT_ERROR:{exc}") from exc

    client = instructor.from_genai(
        client=genai.Client(api_key=api_key),
        mode=instructor.Mode.GEMINI_JSON,
    )

    prompt = (
        "Extraia as questões objetivas do texto fornecido. "
        "Mantenha a numeração original e extraia as alternativas.\n\n"
        f"Texto:\n{source_text[:12000]}"
    )

    try:
        response = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=payload.gemini_model,
            response_model=QuestionsPayload,
            max_retries=2,
        )
        return response
    except Exception as exc:
        raise RuntimeError(f"GEMINI_EXTRACTION_FAILED: {str(exc)}") from exc

def build_success(
    *,
    used_path: str,
    fallback_triggered: bool,
    fallback_reason: str,
    extraction_chars: int,
    questions_payload: QuestionsPayload,
) -> PipelineSuccessResult:
    return PipelineSuccessResult(
        status="ok",
        usedPath=used_path,
        fallbackTriggered=fallback_triggered,
        fallbackReason=fallback_reason,
        totalQuestions=len(questions_payload.questions),
        questions=questions_payload.questions,
        extractionChars=extraction_chars,
    )


def run(payload: PipelineInput) -> PipelineSuccessResult:
    if not Path(payload.file_path).exists():
        raise FileNotFoundError(f"FILE_NOT_FOUND:{payload.file_path}")

    # --- Step 1: OCR extraction via configured provider ---
    ocr_provider = create_ocr_provider(api_key=payload.gemini_api_key)
    _log_stderr(f"OCR provider: {ocr_provider.name}")

    text, confidence = ocr_provider.extract_text(
        payload.file_path,
        page_start=payload.page_start,
        page_end=payload.page_end,
    )
    _log_stderr(f"Primary OCR: {len(text)} chars, confidence={confidence:.2f}")

    # --- Step 2: Try fallback local provider if primary was insufficient ---
    if len(text) < payload.extract_min_chars:
        fallback_provider = create_ocr_fallback_provider()
        if fallback_provider is not None:
            _log_stderr(f"Primary OCR insufficient, trying fallback: {fallback_provider.name}")
            fb_text, fb_confidence = fallback_provider.extract_text(
                payload.file_path,
                page_start=payload.page_start,
                page_end=payload.page_end,
            )
            if len(fb_text) > len(text):
                text = fb_text
                confidence = fb_confidence
                _log_stderr(f"Fallback OCR: {len(text)} chars, confidence={confidence:.2f}")

    # --- Step 3: If we have enough text, extract questions ---
    if len(text) >= payload.extract_min_chars:
        # For local/docling modes: use Gemini to structure the raw text into questions
        # For api mode: text was already extracted by Gemini, still need structuring
        questions = gemini_extract_questions(payload, text)

        return build_success(
            used_path=ocr_provider.name,
            fallback_triggered=True,
            fallback_reason=payload.fallback_reason,
            extraction_chars=len(text),
            questions_payload=questions,
        )

    # --- Step 4: Last resort — send whatever we have to Gemini for structuring ---
    source_text = text if text else (
        f"Arquivo: {Path(payload.file_path).name}. OCR não extraiu conteúdo suficiente."
    )

    fallback_reason = payload.fallback_reason
    if len(text) < payload.extract_min_chars:
        fallback_reason = f"{fallback_reason}|LOW_EXTRACTION_CHARS:{len(text)}"

    _log_stderr(f"All OCR providers insufficient. Attempting Gemini structuring with available text.")
    questions = gemini_extract_questions(payload, source_text)

    return build_success(
        used_path="gemini-structuring-fallback",
        fallback_triggered=True,
        fallback_reason=fallback_reason,
        extraction_chars=len(text),
        questions_payload=questions,
    )


def main() -> None:
    try:
        payload = read_input()
        result = run(payload)
        emit(result)
    except ValidationError as exc:
        emit_error("PIPELINE_VALIDATION_ERROR", exc.json())
    except FileNotFoundError as exc:
        emit_error("PIPELINE_FILE_NOT_FOUND", str(exc))
    except json.JSONDecodeError as exc:
        emit_error("PIPELINE_JSON_PARSE_ERROR", str(exc))
    except ValueError as exc:
        emit_error("PIPELINE_INPUT_ERROR", str(exc))
    except RuntimeError as exc:
        emit_error("PIPELINE_RUNTIME_ERROR", str(exc))
    except Exception as exc:  # pragma: no cover - safeguard
        emit_error("PIPELINE_UNEXPECTED_ERROR", f"{type(exc).__name__}:{exc}")


if __name__ == "__main__":
    main()
