from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class DetectedItem(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)
    quantity: Optional[int] = None


class RecipeGenerateRequest(BaseModel):
    """Request body for POST /api/recipes/generate.

    AI pipeline (3 stages):
      Stage 1 — YOLO11m detects flower regions from the uploaded image → crops
      Stage 2 — Groq Llama 4 Scout classifies each crop → species + confidence
      Stage 3 — Groq Llama 4 Scout generates stem counts + arrangement breakdown

    Note: Pinterest URL input is not supported in MVP. Use image_upload_path instead.
    """

    event_type: str = Field(..., description="Type of event (e.g., 'wedding', 'corporate')")
    style_notes: Optional[str] = Field(None, description="Style or aesthetic notes")
    budget_cents: Optional[int] = Field(None, description="Budget in cents")
    image_crops: Optional[list[str]] = Field(
        default_factory=list,
        description="Base64-encoded JPEG image crops from YOLO Stage 1 detection",
    )
    detected_items: Optional[list[DetectedItem]] = Field(
        default_factory=list,
        description="Pre-classified DetectedItems (populated after Stage 2 crop classification)",
    )


class RecipeGenerateResponse(BaseModel):
    job_id: str
    status: JobStatus = JobStatus.pending
    message: str = "Recipe generation queued"


class SubstitutionRequest(BaseModel):
    item_name: str = Field(..., description="Inventory item to find substitutes for")
    context: Optional[str] = Field(None, description="Event or style context")


class SubstitutionSuggestion(BaseModel):
    substitute: str
    reason: str
    confidence: float = Field(ge=0.0, le=1.0)


class SubstitutionResponse(BaseModel):
    original_item: str
    suggestions: list[SubstitutionSuggestion]


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    result: Optional[dict] = None
    error: Optional[str] = None
