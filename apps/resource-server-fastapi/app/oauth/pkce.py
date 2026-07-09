import base64
import hashlib
import secrets


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_verifier() -> str:
    """Generate a PKCE code_verifier per RFC 7636 §4.1.

    64 random bytes → 86-character base64url with no padding (within the
    43–128 length window).
    """
    return _b64url(secrets.token_bytes(64))


def challenge_s256(verifier: str) -> str:
    """Compute the S256 challenge for a verifier per RFC 7636 §4.2."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return _b64url(digest)
