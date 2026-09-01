# syntax=docker/dockerfile:1
#
# Production resource-server image (FastAPI + uvicorn).
# Build from repo root:
#   docker build -f apps/resource-server-fastapi/Dockerfile -t sassy-resource-server .
#
# See DEPLOYMENT.md for required environment variables.

FROM python:3.11-slim-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && apt-get clean

WORKDIR /app

COPY apps/resource-server-fastapi/pyproject.toml apps/resource-server-fastapi/
COPY apps/resource-server-fastapi/app apps/resource-server-fastapi/app

WORKDIR /app/apps/resource-server-fastapi

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

EXPOSE 8010

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8010}"]
