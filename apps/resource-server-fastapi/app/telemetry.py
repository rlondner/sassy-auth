import sentry_sdk
from fastapi import FastAPI
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.config import get_settings


def _datadog_otlp_url(site: str) -> str:
    return f"https://otlp-http-intake.logs.{site}"


def setup_telemetry(app: FastAPI) -> None:
    settings = get_settings()
    resource = Resource.create({"service.name": settings.OTEL_SERVICE_NAME})
    provider = TracerProvider(resource=resource)

    # Mirrors the TracerProvider below: always construct a real provider and
    # install it globally, but only wire an actual exporter when configured.
    # Without this, `metrics.get_meter(...)` calls (e.g. in verifier.py)
    # resolve against OTel's `_ProxyMeterProvider`, which never becomes a real
    # provider unless `metrics.set_meter_provider(...)` is called somewhere —
    # silently discarding every counter increment.
    metric_readers = []

    if settings.DD_API_KEY:
        base_url = _datadog_otlp_url(settings.DD_SITE)
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=f"{base_url}/v1/traces",
                    headers={"dd-api-key": settings.DD_API_KEY},
                )
            )
        )
        metric_readers.append(
            PeriodicExportingMetricReader(
                OTLPMetricExporter(
                    endpoint=f"{base_url}/v1/metrics",
                    headers={"dd-api-key": settings.DD_API_KEY},
                )
            )
        )

    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    HTTPXClientInstrumentor().instrument(tracer_provider=provider)

    meter_provider = MeterProvider(resource=resource, metric_readers=metric_readers)
    metrics.set_meter_provider(meter_provider)

    if settings.SENTRY_DSN_RESOURCE_SERVER:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN_RESOURCE_SERVER,
            environment=settings.SENTRY_ENVIRONMENT,
            traces_sample_rate=0.2,
        )
