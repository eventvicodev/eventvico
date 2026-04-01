"""Benchmark tests for the AI vision pipeline (Stage 1: YOLO + Stage 2: Groq vision).

These tests require real floral studio images and a live Groq API key.
They are skipped in CI and must be run manually before Story 4.2 is approved for sprint.

HOW TO RUN:
  1. Place test images in eventvico-ai/tests/fixtures/floral_images/
     - Subfolders named by species (e.g., peony/, garden_rose/, eucalyptus/)
     - Minimum 10 images per species, ideally 20+
     - Images should be styled studio/wedding photography (not field photos)
  2. Create a ground_truth.json file in tests/fixtures/:
     {
       "peony/img001.jpg": {"variety": "peony", "stem_count": 12},
       "garden_rose/img002.jpg": {"variety": "garden_rose", "stem_count": 8},
       ...
     }
  3. Set GROQ_API_KEY environment variable
  4. Run: pytest tests/test_vision_pipeline.py -m benchmark -s

ACCURACY TARGETS (from ADR-001):
  - Species identification: ≥85% correct at top-1
  - Stem count variance vs expert: ≤10% mean absolute percentage error (MAPE)
"""

import json
import os
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"
FLORAL_IMAGES_DIR = FIXTURES_DIR / "floral_images"
GROUND_TRUTH_FILE = FIXTURES_DIR / "ground_truth.json"

SPECIES_ACCURACY_TARGET = 0.85  # ≥85% top-1 species identification
STEM_COUNT_MAPE_TARGET = 0.10   # ≤10% mean absolute percentage error


@pytest.mark.skip(reason="Requires real studio images and live GROQ_API_KEY — run manually before Story 4.2 sprint")
@pytest.mark.benchmark
def test_species_identification_accuracy():
    """Stage 2 benchmark: Groq Llama 4 Scout species ID accuracy on real studio images.

    Measures: top-1 accuracy (predicted variety == ground truth variety)
    Target: ≥85% on the test set.
    """
    import asyncio
    from app.services.groq_generator import GroqGenerator

    api_key = os.environ.get("GROQ_API_KEY", "")
    assert api_key, "GROQ_API_KEY must be set to run benchmark tests"
    assert GROUND_TRUTH_FILE.exists(), f"Ground truth file not found: {GROUND_TRUTH_FILE}"

    ground_truth = json.loads(GROUND_TRUTH_FILE.read_text())
    generator = GroqGenerator(api_key=api_key)

    correct = 0
    total = 0
    failures = []

    for rel_path, expected in ground_truth.items():
        image_path = FLORAL_IMAGES_DIR / rel_path
        if not image_path.exists():
            continue

        image_bytes = image_path.read_bytes()
        results = asyncio.run(generator.classify_crops([image_bytes]))

        if not results:
            failures.append({"image": rel_path, "error": "No result returned"})
            total += 1
            continue

        predicted_variety = results[0].label
        expected_variety = expected["variety"]
        total += 1

        if predicted_variety == expected_variety:
            correct += 1
        else:
            failures.append({
                "image": rel_path,
                "expected": expected_variety,
                "got": predicted_variety,
                "confidence": results[0].confidence,
            })

    accuracy = correct / total if total > 0 else 0.0
    print(f"\n--- Species ID Benchmark ---")
    print(f"Total images: {total}")
    print(f"Correct: {correct}")
    print(f"Accuracy: {accuracy:.1%} (target: {SPECIES_ACCURACY_TARGET:.0%})")

    if failures:
        print(f"\nFailures ({len(failures)}):")
        for f in failures[:10]:  # show first 10
            print(f"  {f}")

    assert accuracy >= SPECIES_ACCURACY_TARGET, (
        f"Species ID accuracy {accuracy:.1%} below target {SPECIES_ACCURACY_TARGET:.0%}. "
        f"Review ADR-001 and consider prompt refinement or model upgrade."
    )


@pytest.mark.skip(reason="Requires real studio images and live GROQ_API_KEY — run manually before Story 4.2 sprint")
@pytest.mark.benchmark
def test_stem_count_variance():
    """Stage 3 benchmark: stem count MAPE vs expert florist ground truth.

    Measures: mean absolute percentage error between AI stem counts and expert counts.
    Target: ≤10% MAPE.
    """
    import asyncio
    from app.services.groq_generator import GroqGenerator

    api_key = os.environ.get("GROQ_API_KEY", "")
    assert api_key, "GROQ_API_KEY must be set to run benchmark tests"
    assert GROUND_TRUTH_FILE.exists(), f"Ground truth file not found: {GROUND_TRUTH_FILE}"

    ground_truth = json.loads(GROUND_TRUTH_FILE.read_text())
    generator = GroqGenerator(api_key=api_key)

    errors = []

    for rel_path, expected in ground_truth.items():
        if "stem_count" not in expected:
            continue

        image_path = FLORAL_IMAGES_DIR / rel_path
        if not image_path.exists():
            continue

        image_bytes = image_path.read_bytes()
        detected = asyncio.run(generator.classify_crops([image_bytes]))

        if not detected:
            continue

        recipe = asyncio.run(generator.generate_recipe(
            event_type="wedding",
            style_notes=None,
            budget_cents=None,
            detected_items=detected,
        ))

        predicted_stems = _extract_total_stems(recipe)
        expert_stems = expected["stem_count"]

        if expert_stems > 0 and predicted_stems is not None:
            ape = abs(predicted_stems - expert_stems) / expert_stems
            errors.append(ape)

    if not errors:
        pytest.skip("No stem count ground truth available — add stem_count to ground_truth.json")

    mape = sum(errors) / len(errors)
    print(f"\n--- Stem Count Benchmark ---")
    print(f"Samples: {len(errors)}")
    print(f"MAPE: {mape:.1%} (target: ≤{STEM_COUNT_MAPE_TARGET:.0%})")

    assert mape <= STEM_COUNT_MAPE_TARGET, (
        f"Stem count MAPE {mape:.1%} exceeds target {STEM_COUNT_MAPE_TARGET:.0%}. "
        f"Review Groq prompt in generate_recipe() for better stem count calibration."
    )


def _extract_total_stems(recipe: dict) -> "int | None":
    """Extract total stem count from a generated recipe dict."""
    if not recipe:
        return None
    items = recipe.get("items", [])
    if not items:
        return None
    return sum(item.get("stemCount", 0) for item in items)


# ------------------------------------------------------------------ #
# Unit tests (always run — no images or API key required)             #
# ------------------------------------------------------------------ #

def test_chunk_helper():
    """_chunk splits a list into sub-lists of at most size elements."""
    from app.services.groq_generator import _chunk

    assert _chunk([], 5) == []
    assert _chunk([1, 2, 3], 5) == [[1, 2, 3]]
    assert _chunk([1, 2, 3, 4, 5, 6], 5) == [[1, 2, 3, 4, 5], [6]]
    assert _chunk([1, 2, 3, 4, 5, 6, 7], 3) == [[1, 2, 3], [4, 5, 6], [7]]


def test_safe_json_parse_valid():
    """_safe_json_parse returns parsed JSON on valid input."""
    from app.services.groq_generator import _safe_json_parse

    result = _safe_json_parse('[{"variety": "peony", "confidence": 0.9}]', default=[])
    assert result == [{"variety": "peony", "confidence": 0.9}]


def test_safe_json_parse_invalid():
    """_safe_json_parse returns default on invalid JSON."""
    from app.services.groq_generator import _safe_json_parse

    result = _safe_json_parse("not valid json {{{", default=[])
    assert result == []


def test_classify_crops_returns_empty_without_api_key():
    """classify_crops returns [] when no API key is set (stub behaviour)."""
    import asyncio
    from app.services.groq_generator import GroqGenerator

    generator = GroqGenerator(api_key="")
    result = asyncio.run(generator.classify_crops([b"fake_image_bytes"]))
    assert result == []


def test_classify_crops_returns_empty_on_empty_input():
    """classify_crops returns [] on empty crop list."""
    import asyncio
    from app.services.groq_generator import GroqGenerator

    generator = GroqGenerator(api_key="some-key")
    result = asyncio.run(generator.classify_crops([]))
    assert result == []


# ------------------------------------------------------------------ #
# Job worker — 3-stage pipeline unit tests                            #
# ------------------------------------------------------------------ #

def test_data_url_to_bytes_valid():
    """_data_url_to_bytes decodes a valid base64 data URL."""
    from app.services.job_worker import _data_url_to_bytes
    import base64

    raw = b"fake_jpeg_bytes"
    data_url = f"data:image/jpeg;base64,{base64.b64encode(raw).decode()}"
    assert _data_url_to_bytes(data_url) == raw


def test_data_url_to_bytes_empty():
    """_data_url_to_bytes returns b'' for empty input."""
    from app.services.job_worker import _data_url_to_bytes

    assert _data_url_to_bytes("") == b""


def test_data_url_to_bytes_no_comma():
    """_data_url_to_bytes returns b'' when data URL has no comma separator."""
    from app.services.job_worker import _data_url_to_bytes

    assert _data_url_to_bytes("data:image/jpeg;base64_no_comma") == b""


def test_run_recipe_job_fails_with_no_image():
    """run_recipe_job marks job failed when no image bytes are provided."""
    import asyncio
    from app.services.job_worker import create_job, get_job, run_recipe_job

    job_id = create_job()
    asyncio.run(run_recipe_job(job_id, image_bytes=None, image_data_url=""))

    job = get_job(job_id)
    assert job is not None
    assert job["status"] == "failed"
    assert "No image" in (job["error"] or "")


def test_run_recipe_job_completes_with_stub_pipeline():
    """run_recipe_job runs through all 3 stages and completes (stubs return empty)."""
    import asyncio
    from app.services.job_worker import create_job, get_job, run_recipe_job

    # With stubs (no GROQ_API_KEY, YOLO model not loaded), the pipeline runs
    # through all stages and completes — stubs return empty lists/dicts.
    job_id = create_job()
    asyncio.run(run_recipe_job(
        job_id,
        image_bytes=b"fake_image",
        event_type="wedding",
        style_notes=None,
        budget_cents=None,
    ))

    job = get_job(job_id)
    assert job is not None
    # Stub pipeline completes (generate_recipe returns {})
    assert job["status"] == "completed"
    assert job["result"] == {}


def test_run_recipe_job_unknown_id_is_noop():
    """run_recipe_job silently returns for unknown job IDs."""
    import asyncio
    from app.services.job_worker import run_recipe_job

    # Should not raise
    asyncio.run(run_recipe_job("nonexistent-job-id", image_bytes=b"x"))
