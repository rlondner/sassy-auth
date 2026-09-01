import logging
import json

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as api_router
from app.config import get_settings
from app.oauth.routes import router as oauth_router
from app.telemetry import setup_telemetry
from app.web.routes import router as web_router


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Merge any structured `extra` fields (filtered to JSON-safe types).
        for k, v in record.__dict__.items():
            if k in {
                "args", "msg", "levelname", "levelno", "pathname", "filename",
                "module", "exc_info", "exc_text", "stack_info", "lineno",
                "funcName", "created", "msecs", "relativeCreated", "thread",
                "threadName", "processName", "process", "name", "message",
            }:
                continue
            try:
                json.dumps(v)
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = str(v)
        return json.dumps(payload)


def _configure_logging() -> None:
    s = get_settings()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(s.LOG_LEVEL.upper())


_configure_logging()

app = FastAPI(title="resource-server-fastapi")
setup_telemetry(app)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.include_router(web_router)
app.include_router(oauth_router)
app.include_router(api_router)
