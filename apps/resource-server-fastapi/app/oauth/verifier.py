from typing import Callable
import jwt
from fastapi import Header, HTTPException
from opentelemetry import metrics, trace

from app.config import get_settings

_settings = get_settings()
_jwks_client = jwt.PyJWKClient(
    f"{_settings.AUTH_SERVER_URL}/api/token/jwks",
    cache_keys=True,
    lifespan=600,
)

_tracer = trace.get_tracer("sassy-auth.resource-server")
_meter = metrics.get_meter("sassy-auth.resource-server")
_verify_counter = _meter.create_counter(
    "auth.token.verify.count", description="JWT verification attempts by outcome"
)


def verify(token: str) -> dict:
    with _tracer.start_as_current_span("auth.token.verify") as span:
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=_settings.audience,
                issuer=_settings.issuer,
                options={"require": ["exp", "iat", "sub", "iss", "aud", "scope"]},
            )
            span.set_attribute("auth.outcome", "ok")
            _verify_counter.add(1, {"outcome": "ok"})
            return claims
        except Exception:
            span.set_attribute("auth.outcome", "invalid_token")
            _verify_counter.add(1, {"outcome": "invalid_token"})
            raise HTTPException(
                status_code=401,
                detail={"result": "Unauthorized", "reason": "invalid_token"},
            )


def require_scope(required: str) -> Callable[[str | None], dict]:
    def dep(authorization: str | None = Header(default=None)) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(
                status_code=401,
                detail={"result": "Unauthorized", "reason": "invalid_token"},
            )
        token = authorization.split(" ", 1)[1].strip()
        claims = verify(token)
        scopes = set(str(claims.get("scope", "")).split())
        if required not in scopes:
            raise HTTPException(
                status_code=403,
                detail={"result": "Unauthorized", "reason": "insufficient_scope"},
            )
        return claims

    return dep
