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
