import logging
from fastapi import APIRouter, Depends

from app.oauth.verifier import require_scope

router = APIRouter()
log = logging.getLogger("rs")


# bug-0167: intentionally requires `.create` even though the HTTP verb
# is GET. The demo depends on the Inspectors persona (which holds
# `.read` but not `.create`) getting a 403 so the "different roles ->
# different scopes -> different access" story is visible. Semantically
# GET should require `.read`; the demo takes precedence here. If a
# real read/create split is ever needed, split into a POST
# /api/properties for create and re-scope this GET to `.read`.
@router.get("/api/properties")
def list_properties(claims: dict = Depends(require_scope("rs.properties.create"))):
    log.info("api.properties.granted", extra={"sub": claims.get("sub")})
    return {
        "result": "Authorized",
        "sub": claims.get("sub"),
        "org": claims.get("org"),
    }
