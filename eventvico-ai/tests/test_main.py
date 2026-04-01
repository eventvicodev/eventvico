"""Smoke tests for the Eventvico AI FastAPI service."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "eventvico-ai"


def test_health_does_not_require_service_key():
    """Health endpoint must be reachable without auth for load-balancer probes."""
    response = client.get("/health", headers={})
    assert response.status_code == 200


def test_unauthorized_without_service_key(monkeypatch):
    """Non-health endpoints must reject requests when FASTAPI_SERVICE_KEY is set."""
    monkeypatch.setenv("FASTAPI_SERVICE_KEY", "test-secret-key")
    response = client.post("/api/recipes/generate", json={
        "event_type": "wedding",
    })
    assert response.status_code == 401


def test_authorized_with_service_key(monkeypatch):
    """Requests with the correct key must pass auth (may still get 501 from stub)."""
    monkeypatch.setenv("FASTAPI_SERVICE_KEY", "test-secret-key")
    response = client.post(
        "/api/recipes/generate",
        json={"event_type": "wedding"},
        headers={"X-Service-Key": "test-secret-key"},
    )
    # Stub returns 501 — that's fine; we just want to confirm auth passed
    assert response.status_code == 501
