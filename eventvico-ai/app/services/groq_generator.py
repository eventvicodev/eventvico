"""Groq-powered recipe and substitution generator.

AI pipeline (3 stages):
  Stage 1 — YoloDetector: locate flower regions → bounding boxes + image crops
  Stage 2 — GroqGenerator.classify_crops(): classify each crop → species + confidence
             Uses Llama 4 Scout (meta-llama/llama-4-scout-17b-16e-instruct) vision.
             Crops are batched ≤5 per Groq request.
  Stage 3 — GroqGenerator.generate_recipe(): receive classified DetectedItems + live
             inventory pricing → stem counts + arrangement breakdown.
"""
from __future__ import annotations

import base64
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.schemas import DetectedItem, SubstitutionSuggestion

_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
_CLASSIFY_BATCH_SIZE = 5  # Groq max images per request


class GroqGenerator:
    """Wraps the Groq API for recipe generation, crop classification, and substitutions."""

    def __init__(self, api_key: str = "") -> None:
        self.api_key = api_key

    # ------------------------------------------------------------------ #
    # Stage 2: Vision — classify YOLO crops to flower species              #
    # ------------------------------------------------------------------ #

    async def classify_crops(self, image_crops: list[bytes]) -> list["DetectedItem"]:
        """Classify a list of image crops to flower/décor species using Groq vision.

        Sends crops in batches of ≤5 (Groq API limit). Each crop is base64-encoded
        and sent as an image_url message. Returns a DetectedItem per crop with
        variety, common_name, and confidence.

        Returns an empty list until the Groq API key is configured and the
        full implementation lands in Story 4.2.
        """
        from app.models.schemas import DetectedItem  # local import to avoid circular

        if not self.api_key or not image_crops:
            return []

        results: list[DetectedItem] = []
        batches = _chunk(image_crops, _CLASSIFY_BATCH_SIZE)

        for batch in batches:
            batch_results = await self._classify_batch(batch)
            results.extend(batch_results)

        return results

    async def _classify_batch(self, crops: list[bytes]) -> list["DetectedItem"]:
        """Send one batch of ≤5 crops to Groq Llama 4 Scout for species classification."""
        from app.models.schemas import DetectedItem  # local import to avoid circular

        try:
            from groq import AsyncGroq  # type: ignore[import]
        except ImportError:
            return []

        client = AsyncGroq(api_key=self.api_key)

        # Build content blocks: one text prompt + one image per crop
        content: list[dict] = [
            {
                "type": "text",
                "text": (
                    "You are a professional florist. For each flower image provided, "
                    "identify the flower species as precisely as possible. "
                    "Respond with a JSON array where each element corresponds to one image "
                    "in order. Each element must have: "
                    '"variety" (botanical/common variety, e.g. "garden_rose"), '
                    '"common_name" (e.g. "Garden Rose"), '
                    '"confidence" (float 0.0–1.0). '
                    "Return only the JSON array, no other text."
                ),
            }
        ]

        for crop_bytes in crops:
            b64 = base64.b64encode(crop_bytes).decode("utf-8")
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                }
            )

        response = await client.chat.completions.create(
            model=_VISION_MODEL,
            messages=[{"role": "user", "content": content}],
            max_tokens=512,
        )

        raw = response.choices[0].message.content or "[]"
        parsed = _safe_json_parse(raw, default=[])

        detected: list[DetectedItem] = []
        for item in parsed[: len(crops)]:  # guard against extra elements
            detected.append(
                DetectedItem(
                    label=item.get("variety", "unknown"),
                    confidence=float(item.get("confidence", 0.5)),
                    quantity=None,
                )
            )

        # Pad with low-confidence unknowns if response is short
        while len(detected) < len(crops):
            detected.append(DetectedItem(label="unknown", confidence=0.0))

        return detected

    # ------------------------------------------------------------------ #
    # Stage 3: Text — generate recipe from classified items + inventory   #
    # ------------------------------------------------------------------ #

    async def generate_recipe(
        self,
        event_type: str,
        style_notes: str | None,
        budget_cents: int | None,
        detected_items: list["DetectedItem"],
    ) -> dict:
        """Generate a floral recipe from classified items and live inventory pricing.

        Returns an empty dict until Story 4.2 implements the full prompt chain.
        """
        return {}

    # ------------------------------------------------------------------ #
    # Substitutions                                                        #
    # ------------------------------------------------------------------ #

    async def suggest_substitutions(
        self,
        item_name: str,
        context: str | None,
    ) -> list["SubstitutionSuggestion"]:
        """Suggest substitutes for a given item. Returns an empty list until implemented."""
        return []


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def _chunk(lst: list, size: int) -> "list[list]":
    """Split a list into sub-lists of at most `size` elements."""
    return [lst[i : i + size] for i in range(0, len(lst), size)]


def _safe_json_parse(text: str, default):
    """Parse JSON safely, returning `default` on any error."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return default
