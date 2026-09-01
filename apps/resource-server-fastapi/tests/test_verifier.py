import time
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.oauth.verifier import verify


@pytest.fixture
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    pub_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("ascii")
    )
    return priv_pem, pub_pem


def _sign(priv_pem: str, claims: dict) -> str:
    return jwt.encode(claims, priv_pem, algorithm="RS256", headers={"kid": "test-kid"})


def _stub_pyjwk(monkeypatch, pub_pem: str):
    from app.oauth import verifier as v

    class _Key:
        def __init__(self, pem: str):
            self.key = serialization.load_pem_public_key(pem.encode("ascii"))

    class _StubClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, _token):
            return _Key(pub_pem)

    monkeypatch.setattr(v, "_jwks_client", _StubClient())


def _claims(**overrides):
    now = int(time.time())
    base = {
        "iss": "http://localhost:3000",
        "sub": "user-1",
        "aud": "84LR",
        "iat": now,
        "exp": now + 3600,
        "org": "PwVN",
        "scope": "rs.properties.create rs.properties.read",
    }
    base.update(overrides)
    return base


def test_verify_accepts_valid_token(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    token = _sign(priv, _claims())
    claims = verify(token)
    assert claims["scope"].startswith("rs.properties.create")


def test_verify_rejects_wrong_audience(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    token = _sign(priv, _claims(aud="other-app"))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_rejects_wrong_issuer(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    token = _sign(priv, _claims(iss="https://evil.example"))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_rejects_expired(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    past = int(time.time()) - 10
    token = _sign(priv, _claims(iat=past - 3600, exp=past))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_rejects_missing_scope(monkeypatch, rsa_keypair):
    priv, pub = rsa_keypair
    _stub_pyjwk(monkeypatch, pub)
    claims = _claims()
    claims.pop("scope")
    token = _sign(priv, claims)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        verify(token)
    assert ei.value.status_code == 401


def test_verify_emits_a_span_with_outcome_attribute(monkeypatch):
    monkeypatch.delenv("OTEL_SDK_DISABLED", raising=False)

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    from app.oauth import verifier
    monkeypatch.setattr(verifier, "_tracer", provider.get_tracer("test"))

    from fastapi import HTTPException
    try:
        verifier.verify("not-a-real-jwt")
    except HTTPException:
        pass

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "auth.token.verify"
    assert spans[0].attributes["auth.outcome"] == "invalid_token"
