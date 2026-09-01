import os
from fastapi import FastAPI
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider


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


def _reset_global_meter_provider_once():
    # OTel's metrics API only honors the *first* metrics.set_meter_provider()
    # call per process; later calls are silently ignored (with a warning).
    # setup_telemetry() is exercised repeatedly across this test file with
    # different DD_API_KEY configurations, so — mirroring the same
    # `_TRACER_PROVIDER_SET_ONCE` reset technique already used for
    # TracerProvider elsewhere in this suite — reset the internal "done" flag
    # between tests so each one observes the provider *its own*
    # setup_telemetry() call installed, not a leftover from an earlier test.
    from opentelemetry.metrics._internal import _METER_PROVIDER_SET_ONCE

    _METER_PROVIDER_SET_ONCE._done = False


def test_setup_telemetry_installs_a_real_meter_provider_without_dd_api_key(monkeypatch):
    # Regression test: setup_telemetry() used to only call
    # trace.set_tracer_provider(...) and never metrics.set_meter_provider(...),
    # so any metrics.get_meter(...) call anywhere in the app (e.g.
    # verifier.py's auth.token.verify.count counter) resolved against OTel's
    # unresolved `_ProxyMeterProvider` and every `.add()` call was silently
    # discarded. A real MeterProvider must be installed globally even when
    # DD_API_KEY is unset (mirroring how TracerProvider is always
    # constructed, just without an export processor attached).
    monkeypatch.delenv("DD_API_KEY", raising=False)
    monkeypatch.delenv("SENTRY_DSN_RESOURCE_SERVER", raising=False)
    _reset_global_meter_provider_once()
    from app.telemetry import setup_telemetry

    app = FastAPI()
    setup_telemetry(app)

    provider = metrics.get_meter_provider()
    assert isinstance(provider, MeterProvider)


def test_setup_telemetry_installs_a_meter_provider_with_dd_api_key(monkeypatch):
    monkeypatch.setenv("DD_API_KEY", "test-key")
    monkeypatch.setenv("DD_SITE", "datadoghq.com")
    from app.config import get_settings
    get_settings.cache_clear()
    _reset_global_meter_provider_once()
    from app.telemetry import setup_telemetry

    app = FastAPI()
    setup_telemetry(app)

    provider = metrics.get_meter_provider()
    assert isinstance(provider, MeterProvider)
    # A real metric reader (wired to the Datadog OTLP exporter) is attached
    # to this specific provider instance.
    assert len(provider._metric_readers) == 1
    get_settings.cache_clear()
