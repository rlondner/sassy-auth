import time
import jwt
import pytest
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization


@pytest.fixture
def rsa_keypair():
    pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = pk.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    pub = pk.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    return priv, pub


@pytest.fixture
def app_with_stub_jwks(monkeypatch, rsa_keypair):
    from app.oauth import verifier as v

    class _Key:
        def __init__(self, pem: str):
            self.key = serialization.load_pem_public_key(pem.encode("ascii"))

    class _StubClient:
        def __init__(self, *args, **kwargs):
            pass

        def get_signing_key_from_jwt(self, _token):
            return _Key(rsa_keypair[1])

    monkeypatch.setattr(v, "_jwks_client", _StubClient())

    from app.main import app
    return app


def _mint(priv: str, scope: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "http://localhost:3000",
            "sub": "user-1",
            "aud": "84LR",
            "iat": now,
            "exp": now + 60,
            "org": "PwVN",
            "scope": scope,
        },
        priv,
        algorithm="RS256",
        headers={"kid": "test-kid"},
    )


def test_properties_returns_authorized_when_scope_present(app_with_stub_jwks, rsa_keypair):
    priv, _ = rsa_keypair
    token = _mint(priv, "rs.properties.create rs.properties.read")
    client = TestClient(app_with_stub_jwks)
    res = client.get("/api/properties", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["result"] == "Authorized"


def test_properties_returns_unauthorized_when_scope_missing(app_with_stub_jwks, rsa_keypair):
    priv, _ = rsa_keypair
    token = _mint(priv, "rs.properties.read")
    client = TestClient(app_with_stub_jwks)
    res = client.get("/api/properties", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403
    assert res.json()["detail"]["reason"] == "insufficient_scope"


def test_properties_rejects_missing_bearer(app_with_stub_jwks):
    client = TestClient(app_with_stub_jwks)
    res = client.get("/api/properties")
    assert res.status_code == 401
    assert res.json()["detail"]["reason"] == "invalid_token"
