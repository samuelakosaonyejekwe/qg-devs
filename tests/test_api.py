"""HTTP API contract tests (FastAPI TestClient, isolated QGDEVS_HOME)."""
import importlib

import pytest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["QGDEVS_HOME"] = str(tmp_path_factory.mktemp("var"))
    import qgdevs.jobs
    importlib.reload(qgdevs.jobs)
    import qgdevs.api
    importlib.reload(qgdevs.api)
    from fastapi.testclient import TestClient
    return TestClient(qgdevs.api.app)


SC = {"design": {"geometry": "linear"}, "environment": {}}


def test_health_and_registry(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok"
    suites = client.get("/api/suites").json()
    assert [s["n"] for s in suites] == list(range(1, 19))
    ids = {m["id"] for m in client.get("/api/models").json()}
    assert {"QG-COH", "SC-MF", "CC-KTM", "DP-COLL", "NULL-NG", "CG-QFT-AH"} <= ids


def test_predict_is_computed(client):
    a = client.post("/api/bmv/predict", json=SC).json()
    b = client.post("/api/bmv/predict", json={**SC, "design": {"geometry": "linear", "time": 1.0}}).json()
    assert a["delta_phi_gravity_rad"] != b["delta_phi_gravity_rad"]
    assert a["delta_phi_gravity_rad"] / b["delta_phi_gravity_rad"] == pytest.approx(2.5, rel=1e-12)
    assert "not physical evidence" in a["evidence_status"]
    assert len(a["time_series"]["t"]) >= 10


def test_validation_rejects_bad_input(client):
    assert client.post("/api/bmv/predict", json={"design": {"mass_A": -1}}).status_code == 422
    r = client.post("/api/bmv/predict", json={"design": {"separation": 1e-7, "dx_A": 1e-7, "dx_B": 1e-7}}).json()
    assert r["admissibility_issues"]


def test_thought_requires_approval(client):
    cfg = client.post("/api/thought/interpret", json={"prompt": "two 1e-14 kg masses 450 um apart, superposition "
                                                                "250 um, 2.5 s"}).json()
    assert client.post("/api/thought/execute", json={"config": cfg, "approved": False}).status_code == 403
    out = client.post("/api/thought/execute", json={"config": cfg, "approved": True}).json()
    assert out["prediction"]["delta_phi_total_rad"] != 0


def test_synthetic_label_and_jobs(client):
    rec = client.post("/api/signal/simulate", json={**SC, "shots": 200}).json()
    assert rec["data_label"] == "SYNTHETIC"
    jid = client.post("/api/jobs", json={"type": "vv_run", "params": {"ids": ["S1-rabi"]}}).json()["id"]
    assert client.get(f"/api/jobs/{jid}").json()["status"] == "queued"
    assert client.post("/api/jobs", json={"type": "rm -rf", "params": {}}).status_code == 422


def test_tokens_enforced(client, monkeypatch):
    monkeypatch.setenv("QGDEVS_API_TOKENS", "s3cret:researcher")
    assert client.post("/api/jobs", json={"type": "backup", "params": {}}).status_code == 401
    assert client.post("/api/jobs", json={"type": "backup", "params": {}},
                       headers={"Authorization": "Bearer wrong"}).status_code == 403
    ok = client.post("/api/jobs", json={"type": "backup", "params": {}}, headers={"Authorization": "Bearer s3cret"})
    assert ok.status_code == 200 and ok.json()["role"] == "researcher"


def test_unknown_api_is_404(client):
    assert client.get("/api/does-not-exist").status_code == 404


def test_public_can_compute_but_not_write_evidence(client, monkeypatch):
    monkeypatch.setenv("QGDEVS_API_TOKENS", "s3cret:researcher")
    r = client.post("/api/jobs", json={"type": "vv_run", "params": {"ids": ["S1-rabi"]}})
    assert r.status_code == 200 and r.json()["role"] == "public"
    assert "_client" not in client.get(f"/api/jobs/{r.json()['id']}").json()["params"]
    assert client.post("/api/jobs", json={"type": "backup", "params": {}}).status_code == 401
    d = client.post("/api/evidence/signoff", json={"gate": "G1", "reviewer": "x", "affiliation": "y", "statement": "z"})
    assert d.status_code == 401 and "Settings" in d.json()["detail"]
    for _ in range(3):
        client.post("/api/jobs", json={"type": "vv_run", "params": {"ids": ["S1-rabi"]}})
    assert client.post("/api/jobs", json={"type": "vv_run", "params": {}}).status_code == 429
