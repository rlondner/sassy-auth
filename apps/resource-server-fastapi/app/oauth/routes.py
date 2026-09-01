import logging
import secrets
import time
from urllib.parse import quote, urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from app.config import get_settings
from app.oauth.pkce import challenge_s256, generate_verifier

router = APIRouter()
log = logging.getLogger("rs")
templates = Jinja2Templates(directory="app/templates")

# Process-local PKCE state. Single-instance only.
# Maps state -> (verifier, created_at_unix).
_PENDING: dict[str, tuple[str, float]] = {}


def _purge_expired(now: float, ttl: float) -> None:
    expired = [s for s, (_, ts) in _PENDING.items() if now - ts > ttl]
    for s in expired:
        _PENDING.pop(s, None)


@router.get("/auth/login")
def auth_login() -> RedirectResponse:
    s = get_settings()
    state = secrets.token_urlsafe(32)
    verifier = generate_verifier()
    challenge = challenge_s256(verifier)

    now = time.time()
    _purge_expired(now, s.PKCE_STATE_TTL_SECONDS)
    _PENDING[state] = (verifier, now)

    authorize_qs = urlencode(
        {
            "client_id": s.SASSY_CLIENT_ID,
            "redirect_uri": s.REDIRECT_URI,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    authorize_url = f"{s.AUTH_SERVER_URL}/api/token/oauth/authorize?{authorize_qs}"
    login_url = f"{s.ADMIN_URL}/login?next={quote(authorize_url, safe='')}"

    log.info("auth.login.start", extra={"state": state})
    return RedirectResponse(url=login_url, status_code=302)


@router.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
):
    s = get_settings()
    pending = _PENDING.pop(state, None)
    if pending is None:
        log.warning("auth.callback.error", extra={"state": state, "reason": "unknown_state"})
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": "Authentication state expired or tampered."},
            status_code=400,
        )

    verifier, created = pending
    if time.time() - created > s.PKCE_STATE_TTL_SECONDS:
        log.warning("auth.callback.error", extra={"state": state, "reason": "state_expired"})
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": "Authentication state expired."},
            status_code=400,
        )

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{s.AUTH_SERVER_URL}/api/token/oauth/token",
                json={
                    "code": code,
                    "client_id": s.SASSY_CLIENT_ID,
                    "code_verifier": verifier,
                    "redirect_uri": s.REDIRECT_URI,
                },
            )
        except httpx.HTTPError as e:
            log.warning("auth.callback.error", extra={"state": state, "reason": f"transport:{e!s}"})
            return templates.TemplateResponse(
                request, "error.html",
                {"reason": "Could not reach the auth server."},
                status_code=502,
            )

    if resp.status_code // 100 != 2:
        body = resp.json() if "json" in resp.headers.get("content-type", "") else {"message": resp.text}
        reason = body.get("message") or body.get("error") or "token_exchange_failed"
        log.warning("auth.callback.error", extra={"state": state, "reason": reason})
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": f"Token exchange failed: {reason}"},
            status_code=400,
        )

    body = resp.json()
    token = body.get("access_token")
    if not token:
        return templates.TemplateResponse(
            request, "error.html",
            {"reason": "No access_token in token response."},
            status_code=400,
        )

    # Decoded for display only (no signature check — the auth-server already
    # verified this token during the exchange above, and app.js also decodes
    # it client-side for the same reason). This is what lets amr/idp render
    # server-side in the Jinja template without waiting on JS execution.
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        claims = {}

    log.info("auth.callback.success", extra={"state": state})
    return templates.TemplateResponse(
        request,
        "authorized.html",
        {"access_token": token, "claims": claims},
    )
