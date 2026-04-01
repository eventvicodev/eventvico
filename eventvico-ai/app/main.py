from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import recipes
import os

app = FastAPI(
    title="Eventvico AI Service",
    description="YOLO + Groq/vLLM powered recipe generation microservice",
    version="0.1.0",
)

def _parse_cors_origins(raw: str) -> list[str]:
    parts = [p.strip() for p in raw.split(",")]
    return [p for p in parts if p]


# CORS
# Configure via CORS_ORIGINS env (comma-separated).
# Example: "http://localhost:3000,https://eventvico.vercel.app"
cors_origins = _parse_cors_origins(os.getenv("CORS_ORIGINS", "http://localhost:3000"))
allow_credentials = "*" not in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["POST", "GET"],
    allow_headers=["X-Service-Key", "Content-Type"],
)

# Service key auth middleware
SERVICE_KEY_HEADER = "X-Service-Key"

@app.middleware("http")
async def verify_service_key(request: Request, call_next):
    # Health check is exempt from auth
    if request.url.path.rstrip("/") == "/health":
        return await call_next(request)

    expected_key = os.getenv("FASTAPI_SERVICE_KEY", "").strip()
    if not expected_key:
        return JSONResponse({"error": "Service key not configured"}, status_code=500)

    if request.headers.get(SERVICE_KEY_HEADER) != expected_key:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return await call_next(request)


app.include_router(recipes.router, prefix="/api", tags=["recipes"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "eventvico-ai"}
