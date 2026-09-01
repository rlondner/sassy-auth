import sentry_sdk
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
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

    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    HTTPXClientInstrumentor().instrument(tracer_provider=provider)

    if settings.SENTRY_DSN_RESOURCE_SERVER:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN_RESOURCE_SERVER,
            environment=settings.SENTRY_ENVIRONMENT,
            traces_sample_rate=0.2,
        )
