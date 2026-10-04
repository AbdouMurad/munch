from fastapi.testclient import TestClient

from munch.config import Settings
from munch.main import create_app


def client() -> TestClient:
    return TestClient(create_app(Settings(database_url=None)))


def test_health_without_db() -> None:
    with client() as c:
        resp = c.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_unknown_route_uses_error_shape() -> None:
    with client() as c:
        resp = c.get("/api/nope")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_web_origin_can_be_a_list() -> None:
    settings = Settings(
        database_url=None, web_origin="http://localhost:8081, https://abc.trycloudflare.com/"
    )
    assert settings.web_origin_list == ["http://localhost:8081", "https://abc.trycloudflare.com"]
    with TestClient(create_app(settings)) as client:
        for origin in settings.web_origin_list:
            resp = client.get("/api/health", headers={"Origin": origin})
            assert resp.headers["access-control-allow-origin"] == origin
        other = client.get("/api/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in other.headers
