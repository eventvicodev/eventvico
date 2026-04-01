from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.models.schemas import (
    RecipeGenerateRequest,
    RecipeGenerateResponse,
    SubstitutionRequest,
    SubstitutionResponse,
)

router = APIRouter()


@router.post("/recipes/generate", response_model=RecipeGenerateResponse, status_code=501)
async def generate_recipe(body: RecipeGenerateRequest):
    """Queue an AI recipe generation job using the 3-stage hybrid pipeline.

    Pipeline (implemented in Story 4.2 job_worker.py):
      Stage 1 — YoloDetector.detect(image_bytes) → bounding boxes + image crops
                 Model: YOLO11m (yolo11m.pt)
      Stage 2 — GroqGenerator.classify_crops(crops) → DetectedItem list
                 Model: Llama 4 Scout (meta-llama/llama-4-scout-17b-16e-instruct)
                 Batch size: ≤5 crops per Groq request
      Stage 3 — GroqGenerator.generate_recipe(detected_items, ...) → stem counts + arrangements
                 Model: Llama 4 Scout (text mode, with live inventory pricing)

    Note: Pinterest URL input is not supported. Image upload is the only MVP path.
    """
    return JSONResponse(
        status_code=501,
        content={"error": "Not implemented", "detail": "Recipe generation implemented in Story 4.2"},
    )


@router.post("/recipes/substitutions", response_model=SubstitutionResponse, status_code=501)
async def suggest_substitutions(body: SubstitutionRequest):
    """Suggest inventory substitutions for a given item. Not yet implemented."""
    return JSONResponse(
        status_code=501,
        content={"error": "Not implemented", "detail": "Substitution suggestions coming in a future story"},
    )
