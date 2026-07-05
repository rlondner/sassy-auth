import logging
from fastapi import APIRouter, Depends

from app.oauth.verifier import require_scope

router = APIRouter()
log = logging.getLogger("rs")


@router.get("/api/properties")
def list_properties(claims: dict = Depends(require_scope("rs.properties.read"))):
    log.info("api.properties.granted", extra={"sub": claims.get("sub")})
    return {
        "result": "Authorized",
        "sub": claims.get("sub"),
        "org": claims.get("org"),
    }
