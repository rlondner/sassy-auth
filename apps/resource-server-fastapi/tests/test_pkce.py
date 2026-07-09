import re
from app.oauth.pkce import generate_verifier, challenge_s256


def test_generate_verifier_returns_url_safe_string():
    v = generate_verifier()
    assert isinstance(v, str)
    assert 43 <= len(v) <= 128, "RFC 7636 §4.1 length window"
    assert re.fullmatch(r"[A-Za-z0-9_-]+", v)


def test_generate_verifier_is_unique():
    a = generate_verifier()
    b = generate_verifier()
    assert a != b


def test_challenge_s256_matches_rfc_7636_appendix_b():
    # Test vector from RFC 7636 Appendix B.
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    assert challenge_s256(verifier) == expected


def test_challenge_s256_no_padding():
    verifier = "a" * 64
    c = challenge_s256(verifier)
    assert "=" not in c
    assert "+" not in c
    assert "/" not in c
