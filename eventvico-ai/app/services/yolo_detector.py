"""YOLO-based inventory item detector. Stub — full implementation in a future story."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.schemas import DetectedItem


class YoloDetector:
    """Wraps an Ultralytics YOLO model for floral/event inventory detection."""

    def __init__(self, model_path: str = "yolo11m.pt") -> None:
        self.model_path = model_path
        self._model = None  # lazy-loaded

    def detect(self, image_bytes: bytes) -> list["DetectedItem"]:
        """Run inference on raw image bytes and return detected items.

        Returns an empty list until the model is loaded and the full
        implementation lands in a future story.
        """
        return []
