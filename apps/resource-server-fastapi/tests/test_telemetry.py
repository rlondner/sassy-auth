import os
from fastapi import FastAPI


def test_setup_telemetry_noops_without_dd_or_sentry_keys(monkeypatch):
    monkeypatch.delenv("DD_API_KEY", raising=False)
    monkeypatch.delenv("SENTRY_DSN_RESOURCE_SERVER", raising=False)
    from app.telemetry import setup_telemetry

    app = FastAPI()
    setup_telemetry(app)  # must not raise


def test_setup_telemetry_does_not_raise_with_dd_api_key(monkeypatch):
    monkeypatch.setenv("DD_API_KEY", "test-key")
    monkeypatch.setenv("DD_SITE", "datadoghq.com")
    from app.config import get_settings
    get_settings.cache_clear()
    from app.telemetry import setup_telemetry

    app = FastAPI()
    setup_telemetry(app)  # exporter construction must not raise even though unreachable
    get_settings.cache_clear()
