# ADR-001: AI Vision Pipeline Architecture

**Date:** 2026-04-01
**Status:** Accepted
**Deciders:** Architect, Dev

---

## Context

The original Eventvico architecture assumed:
1. YOLO (vanilla YOLOv8n) handles both flower detection and species identification
2. Groq is used for text-only recipe generation
3. Pinterest board URLs are a core MVP input path for AI recipe generation

Research conducted 2026-04-01 revealed all three assumptions required revision before Epic 4 implementation.

---

## Decision 1: Upgrade YOLO model from YOLOv8n to YOLO11m

### Problem
`yolov8n.pt` (YOLOv8 nano) is the smallest and least accurate YOLO variant, trained on COCO dataset (80 generic classes). It will not reliably distinguish flower species (e.g. garden rose vs. spray rose vs. peony) — the core value of the AI detection feature.

### Decision
Use `yolo11m.pt` (YOLO11 medium) as the default model.

### Rationale
- **Same pip package:** `ultralytics` serves both YOLOv8 and YOLO11 — zero dependency change
- **C2PSA spatial attention:** YOLO11 introduces Cross Stage Partial with Spatial Attention blocks, which materially improve fine-grained visual discrimination between visually similar classes
- **Benchmark:** YOLO11m achieves 51.5 mAP@50-95 on COCO vs YOLOv8n's 39.5 — a 12-point gap at the same inference speed tier
- **22% fewer parameters than YOLOv8m** while matching or exceeding accuracy

### Trade-offs
- `yolo11m.pt` (~40MB) is larger than `yolov8n.pt` (~6MB) — acceptable for a GPU-enabled server container
- First-run model download via Ultralytics auto-download (same behaviour as YOLOv8)

### Note on custom fine-tuning
Vanilla YOLO11m is still trained on COCO generic classes. Species-level accuracy (garden rose vs. peony) will require domain fine-tuning on a labeled floral dataset. This is deferred to post-MVP. For MVP, YOLO handles region detection (flower vs. background) and Groq vision handles species identification (see Decision 2).

---

## Decision 2: Hybrid pipeline — YOLO11m (detect) + Groq Llama 4 Scout (classify + generate)

### Problem
YOLO alone cannot reliably identify flower species at the specificity required (garden rose vs. spray rose vs. ranunculus). Building a species-level YOLO detector requires 200–500 labeled images per class — no suitable public dataset exists at the required specificity for floral studio photography.

The original architecture assumed Groq was text-only. As of April 2025, Groq supports vision via Llama 4 Scout.

### Decision
Implement a 3-stage hybrid pipeline:

```
Stage 1 — YOLO11m
  Input:  Raw image bytes
  Output: Bounding boxes + image crops (one crop per detected flower region)
  Model:  yolo11m.pt

Stage 2 — Groq Llama 4 Scout (vision)
  Input:  Image crops (batched ≤5 per Groq request)
  Output: DetectedItem list (variety, common_name, confidence per crop)
  Model:  meta-llama/llama-4-scout-17b-16e-instruct

Stage 3 — Groq Llama 4 Scout (text)
  Input:  DetectedItem list + live inventory pricing + event_type + budget
  Output: Stem counts + arrangement breakdown (arrangements, items, totals)
  Model:  meta-llama/llama-4-scout-17b-16e-instruct
```

### Rationale
- **Zero labeled training data required for species ID:** Llama 4 Scout uses zero-shot vision — new flower species handled by prompt update, not model retraining
- **Single vendor:** Both vision classification (Stage 2) and recipe generation (Stage 3) use Groq — no additional API dependencies
- **Cost:** Llama 4 Scout at $0.11/M input tokens is ~45× cheaper than GPT-4o Vision ($5/M tokens)
- **Accuracy split:** YOLO handles what it does well (object localisation); VLM handles what it does well (semantic species identification from tight crops). Tight crops improve VLM accuracy vs. processing the full complex scene.
- **Groq Llama 4 Scout:** Released April 2025 on Groq with native multimodal early fusion (not adapter-based). Supports up to 5 images per request, 128K context, 460+ tokens/s.

### Trade-offs
- **Latency:** Two Groq calls per generation (Stage 2 + Stage 3) vs. one. Within 60-second SLA.
- **Batch limit:** Groq max 5 images per request. Images chunked accordingly in `classify_crops`.
- **Accuracy ceiling:** VLM species ID is not infallible on styled photography — the mandatory human review gate (FR25, FR26) in the UI is non-negotiable. AI produces a draft; human confirms.

### Pre-production benchmark targets
- ≥85% correct species identification on 200+ real studio images
- ≤10% stem count variance vs. expert florist manual counts

See `tests/test_vision_pipeline.py` for benchmark test scaffold.

---

## Decision 3: Pinterest URL input deferred to post-MVP

### Problem
Pinterest actively blocks scraping. Any HTML/API scraping approach will break unpredictably within weeks of launch as Pinterest rotates selectors and enforces bot detection. A stable Pinterest integration requires the official Pinterest API, which has an approval process.

### Decision
Remove Pinterest URL from `RecipeGenerateRequest`. Direct image upload is the sole MVP input path.

### Rationale
- **Reliability:** Scraping-based Pinterest will break in production; direct upload is deterministic
- **Scope:** The AI value proposition (image → recipe) is fully demonstrated via direct upload
- **Deferral path:** Pinterest integration can be added post-MVP once Pinterest API access is approved

### Impact on existing code
- `RecipeGenerateRequest.pinterest_url` field removed from `schemas.py`
- UI: "Paste Pinterest URL" input removed from `/recipes/ai` page in Story 4.2

---

## Alternatives Considered

| Approach | Rejected Reason |
|---|---|
| YOLO fine-tuned on flower species (only) | Requires 200–500 labeled images/species; no public dataset at required specificity; blocks MVP |
| GPT-4o Vision instead of Groq | 45× more expensive; Groq preferred given existing Groq dependency |
| Plant.id API for species ID | Third-party dependency; no bounding boxes; per-call cost; less control over schema |
| CLIP zero-shot classification | Not a detector — no bounding boxes; lower accuracy than VLM on styled photography |

---

## Implementation Files

| File | Change |
|---|---|
| `eventvico-ai/app/services/yolo_detector.py` | Default model: `yolov8n.pt` → `yolo11m.pt` |
| `eventvico-ai/app/services/groq_generator.py` | Added `classify_crops()` method with batch chunking |
| `eventvico-ai/app/models/schemas.py` | `RecipeGenerateRequest`: added `image_crops`, removed `pinterest_url` |
| `eventvico-ai/app/routers/recipes.py` | Pipeline stage comments updated |
| `eventvico-ai/tests/test_vision_pipeline.py` | Benchmark test scaffold (manual run) |

---

## Review

This ADR is to be reviewed and confirmed after the pre-production benchmark (≥20 real studio images) before Story 4.2 is scheduled for a sprint.
ci trigger Thu Apr  2 00:13:04 EDT 2026
