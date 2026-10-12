"""Unit tests for the Python OCR/structuring pipeline — no network, no real
Ollama/Gemini calls. All external I/O is mocked."""

import io
import json

import pytest
from pydantic import ValidationError

import main as pipeline
import ocr_provider


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_input(**overrides) -> pipeline.PipelineInput:
    data = {
        "exam_id": "exam-1",
        "file_path": "/tmp/fake.pdf",
        "fallback_reason": "test",
    }
    data.update(overrides)
    return pipeline.PipelineInput(**data)


class StubProvider:
    def __init__(self, name: str, result: ocr_provider.OCRResult):
        self._name = name
        self._result = result

    @property
    def name(self) -> str:
        return self._name

    def extract_text(self, file_path, page_start=None, page_end=None):
        return self._result


def stub_questions(n: int = 1) -> pipeline.QuestionsPayload:
    return pipeline.QuestionsPayload(
        questions=[
            pipeline.Question(order=i, questionText=f"Q{i}?", options=["A", "B"])
            for i in range(1, n + 1)
        ]
    )


LONG_TEXT = "questão " * 100  # > default extract_min_chars


# ---------------------------------------------------------------------------
# PipelineInput validation
# ---------------------------------------------------------------------------


class TestPipelineInput:
    def test_minimal_valid(self):
        p = make_input()
        assert p.extract_min_chars == 180
        assert p.gemini_model == "gemini-2.5-flash"
        assert p.prova_type is None

    def test_page_end_before_start_rejected(self):
        with pytest.raises((ValidationError, ValueError)):
            make_input(page_start=5, page_end=2)

    def test_page_range_ok(self):
        p = make_input(page_start=2, page_end=5)
        assert p.page_start == 2 and p.page_end == 5

    def test_empty_exam_id_rejected(self):
        with pytest.raises(ValidationError):
            make_input(exam_id="")


# ---------------------------------------------------------------------------
# Question schema (D10 optional fields)
# ---------------------------------------------------------------------------


class TestQuestionSchema:
    def test_optional_fields_default_none(self):
        q = pipeline.Question(order=1, questionText="texto")
        assert q.correctAnswer is None
        assert q.sourcePage is None
        assert q.contextText is None
        assert q.requiresFigure is None

    def test_optional_fields_serialize(self):
        q = pipeline.Question(
            order=3,
            questionText="texto",
            correctAnswer="C",
            sourcePage=2,
            contextText="base",
            requiresFigure=True,
        )
        data = json.loads(q.model_dump_json())
        assert data["correctAnswer"] == "C"
        assert data["sourcePage"] == 2
        assert data["requiresFigure"] is True


# ---------------------------------------------------------------------------
# Provider factory (docling removed — C1)
# ---------------------------------------------------------------------------


class TestFactory:
    def test_local(self, monkeypatch):
        monkeypatch.setenv("OCR_PROVIDER", "local")
        p = ocr_provider.create_ocr_provider()
        assert isinstance(p, ocr_provider.OllamaOCRProvider)
        assert p.name == "ollama-glm-ocr"

    def test_api(self, monkeypatch):
        monkeypatch.setenv("OCR_PROVIDER", "api")
        p = ocr_provider.create_ocr_provider(api_key="k")
        assert isinstance(p, ocr_provider.GeminiOCRProvider)
        assert p.name == "gemini"

    def test_unknown_fails_explicit(self, monkeypatch):
        monkeypatch.setenv("OCR_PROVIDER", "bogus")
        with pytest.raises(ValueError, match="Unknown OCR_PROVIDER"):
            ocr_provider.create_ocr_provider()

    def test_docling_removed(self, monkeypatch):
        monkeypatch.setenv("OCR_PROVIDER", "docling")
        with pytest.raises(ValueError):
            ocr_provider.create_ocr_provider()

    def test_fallback_name_derives_from_model(self, monkeypatch):
        monkeypatch.setenv("OLLAMA_OCR_FALLBACK_MODEL", "minicpm-v")
        p = ocr_provider.OllamaFallbackOCRProvider()
        assert p.name == "ollama-minicpm-v"


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------


class TestRetry:
    def test_eventual_success(self, monkeypatch):
        monkeypatch.setattr(ocr_provider, "RETRY_DELAYS", (0.0, 0.0, 0.0))
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] < 3:
                raise ConnectionError("down")
            return "ok"

        assert ocr_provider._with_retry(flaky, "t") == "ok"
        assert calls["n"] == 3

    def test_exhaustion_raises(self, monkeypatch):
        monkeypatch.setattr(ocr_provider, "RETRY_DELAYS", (0.0, 0.0, 0.0))
        with pytest.raises(RuntimeError):
            ocr_provider._with_retry(
                lambda: (_ for _ in ()).throw(RuntimeError("nope")), "t"
            )


# ---------------------------------------------------------------------------
# Page errors (D12)
# ---------------------------------------------------------------------------


class TestPageErrors:
    def test_failed_page_recorded_not_silent(self, monkeypatch, tmp_path):
        monkeypatch.setattr(ocr_provider, "RETRY_DELAYS", (0.0, 0.0, 0.0))
        provider = ocr_provider.OllamaOCRProvider()
        images = [str(tmp_path / f"p{i}.png") for i in range(3)]

        def fake_ocr(path):
            if "p1" in path:
                raise ConnectionError("ollama down")
            return "texto extraído da página"

        monkeypatch.setattr(provider, "_process_single_image", fake_ocr)
        result = provider._ocr_images(images, page_start=1)

        assert result.pages_failed == 1
        assert result.pages_processed == 2
        assert result.page_errors == [{"page": 2, "error": "ollama down"}]
        assert "[Página 1]" in result.text and "[Página 3]" in result.text

    def test_page_numbers_respect_page_start(self, monkeypatch, tmp_path):
        monkeypatch.setattr(ocr_provider, "RETRY_DELAYS", (0.0, 0.0, 0.0))
        provider = ocr_provider.OllamaOCRProvider()
        monkeypatch.setattr(
            provider, "_process_single_image", lambda p: (_ for _ in ()).throw(RuntimeError("x"))
        )
        result = provider._ocr_images(["a", "b"], page_start=5)
        assert [e["page"] for e in result.page_errors] == [5, 6]
        assert result.pages_processed == 0


# ---------------------------------------------------------------------------
# run() orchestration — needs_review & fallback flags (D11)
# ---------------------------------------------------------------------------


class TestRun:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr(ocr_provider, "RETRY_DELAYS", (0.0, 0.0, 0.0))

    def test_insufficient_content_needs_review(self, monkeypatch, tmp_path):
        f = tmp_path / "exam.pdf"
        f.write_text("x")
        monkeypatch.setattr(
            pipeline, "create_ocr_provider",
            lambda **kw: StubProvider("stub-ocr", ocr_provider.OCRResult(text="tiny", confidence=0.0)),
        )
        monkeypatch.setattr(pipeline, "create_ocr_fallback_provider", lambda: None)

        result = pipeline.run(make_input(file_path=str(f)))
        assert result.status == "needs_review"
        assert result.errorCode == "PIPELINE_INSUFFICIENT_CONTENT"
        assert result.extractionChars == 4

    def test_no_questions_needs_review(self, monkeypatch, tmp_path):
        f = tmp_path / "exam.pdf"
        f.write_text("x")
        monkeypatch.setattr(
            pipeline, "create_ocr_provider",
            lambda **kw: StubProvider("stub-ocr", ocr_provider.OCRResult(text=LONG_TEXT, confidence=1.0)),
        )
        monkeypatch.setattr(
            pipeline, "gemini_extract_questions",
            lambda payload, text: pipeline.QuestionsPayload(questions=[]),
        )

        result = pipeline.run(make_input(file_path=str(f)))
        assert result.status == "needs_review"
        assert result.errorCode == "PIPELINE_NO_QUESTIONS"

    def test_success_primary_wins(self, monkeypatch, tmp_path):
        f = tmp_path / "exam.pdf"
        f.write_text("x")
        ocr_res = ocr_provider.OCRResult(
            text=LONG_TEXT, confidence=1.0, pages_processed=3, pages_failed=0
        )
        monkeypatch.setattr(
            pipeline, "create_ocr_provider",
            lambda **kw: StubProvider("primary-ocr", ocr_res),
        )
        monkeypatch.setattr(
            pipeline, "gemini_extract_questions",
            lambda payload, text: stub_questions(2),
        )

        result = pipeline.run(make_input(file_path=str(f)))
        assert result.status == "ok"
        assert result.usedPath == "primary-ocr"
        assert result.fallbackTriggered is False
        assert result.totalQuestions == 2
        assert result.pagesProcessed == 3
        assert result.pageErrors is None

    def test_fallback_wins_reports_real_path(self, monkeypatch, tmp_path):
        f = tmp_path / "exam.pdf"
        f.write_text("x")
        monkeypatch.setattr(
            pipeline, "create_ocr_provider",
            lambda **kw: StubProvider("primary-ocr", ocr_provider.OCRResult(text="t", confidence=0.0)),
        )
        monkeypatch.setattr(
            pipeline, "create_ocr_fallback_provider",
            lambda: StubProvider(
                "ollama-qwen2.5vl:3b",
                ocr_provider.OCRResult(
                    text=LONG_TEXT,
                    confidence=0.9,
                    page_errors=[{"page": 2, "error": "boom"}],
                    pages_processed=4,
                    pages_failed=1,
                ),
            ),
        )
        monkeypatch.setattr(
            pipeline, "gemini_extract_questions",
            lambda payload, text: stub_questions(1),
        )

        result = pipeline.run(make_input(file_path=str(f)))
        assert result.status == "ok"
        assert result.usedPath == "ollama-qwen2.5vl:3b"
        assert result.fallbackTriggered is True
        assert result.pageErrors == [pipeline.PageError(page=2, error="boom")]
        assert result.pagesFailed == 1

    def test_fallback_not_better_keeps_primary(self, monkeypatch, tmp_path):
        f = tmp_path / "exam.pdf"
        f.write_text("x")
        short = "a" * 50
        monkeypatch.setattr(
            pipeline, "create_ocr_provider",
            lambda **kw: StubProvider("primary-ocr", ocr_provider.OCRResult(text=short, confidence=0.1)),
        )
        monkeypatch.setattr(
            pipeline, "create_ocr_fallback_provider",
            lambda: StubProvider("fb", ocr_provider.OCRResult(text="b" * 10, confidence=0.0)),
        )

        result = pipeline.run(make_input(file_path=str(f)))
        # Both insufficient → needs_review, but extractionChars = the better one
        assert result.status == "needs_review"
        assert result.extractionChars == 50


# ---------------------------------------------------------------------------
# main() end-to-end: stdout purity + error payloads
# ---------------------------------------------------------------------------


class TestMain:
    def test_invalid_json_emits_error(self, monkeypatch, capsys):
        monkeypatch.setattr("sys.stdin", io.StringIO("{bad json"))
        pipeline.main()
        out = capsys.readouterr().out
        result = json.loads(out)
        assert result["status"] == "error"
        assert result["errorCode"] == "PIPELINE_VALIDATION_ERROR"

    def test_empty_stdin_emits_error(self, monkeypatch, capsys):
        monkeypatch.setattr("sys.stdin", io.StringIO(""))
        pipeline.main()
        result = json.loads(capsys.readouterr().out)
        assert result["status"] == "error"

    def test_file_not_found(self, monkeypatch, capsys):
        payload = json.dumps({
            "exam_id": "e1",
            "file_path": "/nonexistent/x.pdf",
            "fallback_reason": "t",
        })
        monkeypatch.setattr("sys.stdin", io.StringIO(payload))
        pipeline.main()
        result = json.loads(capsys.readouterr().out)
        assert result["status"] == "error"
        assert result["errorCode"] == "PIPELINE_FILE_NOT_FOUND"

    def test_needs_review_end_to_end(self, monkeypatch, capsys, tmp_path):
        f = tmp_path / "exam.pdf"
        f.write_text("x")
        monkeypatch.setattr(
            pipeline, "create_ocr_provider",
            lambda **kw: StubProvider("stub", ocr_provider.OCRResult(text="", confidence=0.0)),
        )
        monkeypatch.setattr(pipeline, "create_ocr_fallback_provider", lambda: None)
        payload = json.dumps({
            "exam_id": "e1",
            "file_path": str(f),
            "fallback_reason": "t",
        })
        monkeypatch.setattr("sys.stdin", io.StringIO(payload))
        pipeline.main()
        out = capsys.readouterr().out
        result = json.loads(out)
        assert result["status"] == "needs_review"
        assert result["errorCode"] == "PIPELINE_INSUFFICIENT_CONTENT"
        # stdout must be a single parseable JSON document
        json.loads(out.strip())
