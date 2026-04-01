"""Background job worker for async AI recipe generation tasks.

Pipeline (3 stages, per ADR-001):
  Stage 1 — YoloDetector.detect(image_bytes): locate flower regions → bounding box crops
             Model: YOLO11m (yolo11m.pt)
  Stage 2 — GroqGenerator.classify_crops(crops): identify species per crop
             Model: Llama 4 Scout (meta-llama/llama-4-scout-17b-16e-instruct)
             Batch: ≤5 crops per Groq request
  Stage 3 — GroqGenerator.generate_recipe(detected_items, ...): stem counts + arrangement breakdown
             Model: Llama 4 Scout (text mode with live inventory pricing)
"""
from __future__ import annotations

import base64
import os
import uuid
from typing import Any

from app.models.schemas import DetectedItem
from app.services.groq_generator import GroqGenerator
from app.services.yolo_detector import YoloDetector

# In-memory job store — replaced by Supabase ai_jobs polling in the full deployment
_jobs: dict[str, dict[str, Any]] = {}

_detector: YoloDetector | None = None
_generator: GroqGenerator | None = None


def _get_detector() -> YoloDetector:
    global _detector
    if _detector is None:
        _detector = YoloDetector()
    return _detector


def _get_generator() -> GroqGenerator:
    global _generator
    if _generator is None:
        _generator = GroqGenerator(api_key=os.getenv("GROQ_API_KEY", ""))
    return _generator


def create_job() -> str:
    """Create a new job entry and return its ID."""
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "pending", "result": None, "error": None}
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    """Return job metadata by ID, or None if not found."""
    return _jobs.get(job_id)


async def run_recipe_job(
    job_id: str,
    image_bytes: bytes | None = None,
    image_data_url: str | None = None,
    event_type: str = "wedding",
    style_notes: str | None = None,
    budget_cents: int | None = None,
) -> None:
    """Execute a recipe generation job using the 3-stage hybrid pipeline.

    Args:
        job_id:         Job ID to update on completion/failure.
        image_bytes:    Raw image bytes (preferred — used when called from FastAPI route).
        image_data_url: Base64 data URL fallback (used when job originated from Next.js queue).
        event_type:     Type of event (e.g. "wedding", "corporate").
        style_notes:    Optional aesthetic notes from the studio user.
        budget_cents:   Optional budget cap in cents.
    """
    if job_id not in _jobs:
        return

    _jobs[job_id]["status"] = "processing"

    try:
        # Resolve image bytes from data URL if raw bytes not provided
        raw_bytes = image_bytes or _data_url_to_bytes(image_data_url or "")
        if not raw_bytes:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = "No image provided for recipe generation."
            return

        detector = _get_detector()
        generator = _get_generator()

        # ── Stage 1: YOLO11m — detect flower regions ──────────────────────────
        detected_items: list[DetectedItem] = detector.detect(raw_bytes)

        # ── Stage 2: Groq Llama 4 Scout vision — classify species ─────────────
        # If YOLO returned items already with labels, use those.
        # If YOLO stub is still active (returns []), send the full image as a
        # single crop so Groq can do direct species identification as fallback.
        if not detected_items and raw_bytes:
            classified = await generator.classify_crops([raw_bytes])
        else:
            # Convert YOLO bounding box crops (stored in item.image_crop if present)
            # to bytes for Groq classification. For now, pass the raw image as each crop.
            classified = await generator.classify_crops(
                [raw_bytes] * max(1, len(detected_items))
            )

        # Merge YOLO quantity data with Groq species labels
        for i, item in enumerate(classified):
            if i < len(detected_items) and detected_items[i].quantity is not None:
                item.quantity = detected_items[i].quantity

        # ── Stage 3: Groq Llama 4 Scout text — generate recipe ─────────────────
        recipe = await generator.generate_recipe(
            event_type=event_type,
            style_notes=style_notes,
            budget_cents=budget_cents,
            detected_items=classified,
        )

        _jobs[job_id]["status"] = "completed"
        _jobs[job_id]["result"] = recipe

    except Exception as exc:  # noqa: BLE001
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(exc)


def _data_url_to_bytes(data_url: str) -> bytes:
    """Decode a base64 data URL to raw bytes. Returns b'' on failure."""
    try:
        if "," not in data_url:
            return b""
        _, encoded = data_url.split(",", 1)
        return base64.b64decode(encoded)
    except Exception:  # noqa: BLE001
        return b""
