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


# ------------------------------------------------------------------ audit regressions: validation (no 500s, no DoS)
@pytest.mark.parametrize("method,url,body", [
    ("post", "/api/bmv/sweep1d?param=foo&n=3", SC),                     # silently returned an unchanged design
    ("post", "/api/bmv/sweep1d?n=0", SC),
    ("post", "/api/bmv/sweep2d", {**SC, "xs": [4e-4], "ys": [2e-4], "hypothesis": "X"}),
    ("post", "/api/bmv/sweep2d", '{"design": {}, "environment": {}, "xs": [NaN], "ys": [2e-4]}'),
    ("post", "/api/decoherence/budget", {"design": {}, "environment": {"material": "x"}}),
    ("post", "/api/gravity/orbit?a=0", None),
    ("post", "/api/gravity/orbit?a=10", None),                          # inside the strong-field region
    ("post", "/api/gravity/nbody", {"masses": [1, 1], "positions": [[0, 0, 0]], "velocities": [[0, 0, 0]],
                                    "dt": 1, "steps": 2}),
    ("post", "/api/gravity/nbody", {"masses": [1, 1], "positions": [[0, 0, 0], [1, 0, 0]],
                                    "velocities": [[0, 0, 0], [0, 0, 0]], "dt": 1, "steps": 200000, "save_every": 1}),
    ("post", "/api/interferometry/wavepacket2d?frames=0", None),
    ("post", "/api/interferometry/wavepacket2d?n=1", None),
    ("post", "/api/interferometry/wavepacket2d?mass=0", None),
    ("post", "/api/quantum/lindblad", {"H_re": [[1, 0], [0]], "rho0_re": [[1, 0], [0, 0]], "t_final": 1}),
    ("post", "/api/quantum/lindblad", {"H_re": [[1, 0], [0, 1]], "rho0_re": [[1]], "t_final": 1}),
    ("post", "/api/quantum/lindblad", {"H_re": [[1, 0], [0, 1]], "L_re": [[[1]]], "rho0_re": [[1, 0], [0, 0]],
                                       "t_final": 1}),
    ("post", "/api/quantum/lindblad", {"H_re": [[1e6, 0], [0, 1]], "rho0_re": [[1, 0], [0, 0]], "t_final": 1e3}),
    ("post", "/api/signal/simulate", {**SC, "settings": ["QQ"]}),
    ("post", "/api/signal/simulate", {**SC, "seed": -1}),
    ("post", "/api/signal/tomography", {"counts": {s: [1] for s in ["XX", "XY", "XZ", "YX", "YY", "YZ", "ZX", "ZY", "ZZ"]}}),
    ("post", "/api/signal/injection?trials=0", None),
    ("post", "/api/evidence/gates?hypothesis=X", SC),
    ("post", "/api/thought/execute", {"config": {"family": "bmv", "material": "x"}, "approved": True}),
    ("post", "/api/thought/execute", {"config": {"family": "bmv", "geometry": "x"}, "approved": True}),
    ("post", "/api/thought/execute", {"config": {"family": "optomech", "quantities": {
        "frequency": {"value": 1e9, "unit": "rad/s"}}}, "approved": True}),
    ("post", "/api/discovery/scaling?seed=-1", None),
    ("get", "/api/evidence/ledger?limit=-1", None),
    ("post", "/api/optomech/evolve?omega=1e5&t_final=1e3", None),        # ~1e8 rad of stiff ODE: hours of CPU
])
def test_invalid_inputs_are_rejected_not_crashing(client, method, url, body):
    if isinstance(body, str):  # raw JSON (e.g. NaN literals, which Python's json module accepts)
        kw = {"content": body, "headers": {"content-type": "application/json"}}
    else:
        kw = {"json": body} if body is not None else {}
    r = getattr(client, method)(url, **kw)
    assert r.status_code == 422, (url, r.status_code, r.text[:200])


def test_malformed_content_length_is_400(client):
    assert client.get("/api/health", headers={"content-length": "abc"}).status_code == 400


def test_upload_size_enforced_without_content_length(client, monkeypatch):
    import qgdevs.api
    monkeypatch.setattr(qgdevs.api, "MAX_UPLOAD_BYTES", 1000)
    r = client.post("/api/data/validate", files={"file": ("a.json", b"[" + b"1," * 2000 + b"1]")})
    assert r.status_code == 413


def test_angled_sg_endpoint_not_treated_as_linear(client):
    lin = client.post("/api/interferometry/sg", json={"design": {"geometry": "linear"}}).json()["delta_phi"]
    ang = client.post("/api/interferometry/sg", json={"design": {"geometry": "angled", "angle_deg": 45}}).json()
    assert ang["delta_phi"] != pytest.approx(lin, rel=1e-3)


def test_deployed_image_without_tokens_is_not_open(client, monkeypatch):
    monkeypatch.delenv("QGDEVS_API_TOKENS", raising=False)
    monkeypatch.setenv("QGDEVS_REQUIRE_TOKENS", "1")
    d = client.post("/api/evidence/signoff", json={"gate": "G1", "reviewer": "x", "affiliation": "y", "statement": "z"})
    assert d.status_code == 401


def test_public_sees_no_tracebacks_and_cannot_cancel_researcher_jobs(client, monkeypatch):
    from qgdevs.jobs import JobStore
    st = JobStore()
    jid = st.submit("vv_run", {"_role": "researcher", "_client": "testclient"})
    st.finish(jid, "failed", error='Traceback (most recent call last):\n  File "/srv/app/x.py", line 1\nValueError: boom')
    monkeypatch.setenv("QGDEVS_API_TOKENS", "s3cret:researcher")
    pub = client.get(f"/api/jobs/{jid}").json()
    assert pub["error"] == "ValueError: boom" and "result_path" not in pub
    assert all("/srv/app" not in (j["error"] or "") for j in client.get("/api/jobs").json()["jobs"])
    res = client.get(f"/api/jobs/{jid}", headers={"Authorization": "Bearer s3cret"}).json()
    assert "/srv/app" in res["error"]
    q = st.submit("vv_run", {"_role": "researcher", "_client": "testclient"})
    assert client.post(f"/api/jobs/{q}/cancel").status_code == 403  # same client address, researcher's job


def test_vv_latest_ignores_partial_runs(client):
    import json as _json
    from qgdevs.jobs import JobStore, paths
    st = JobStore()
    jid = st.submit("vv_run", {"ids": ["S1-rabi"]})
    out = paths()["results"] / f"{jid}.json"
    out.write_text(_json.dumps({"summary": {"total": 1, "passed": 1, "failed": 0}, "results": []}))
    with st._c() as c:
        c.execute("update jobs set status='succeeded', result_path=?, created='9999' where id=?", (str(out), jid))
    latest = client.get("/api/vv/latest").json()
    assert latest.get("job", {}).get("id") != jid


def test_public_language_model_requests_fall_back(client, monkeypatch):
    monkeypatch.setenv("QGDEVS_API_TOKENS", "s3cret:researcher")
    called = []
    import qgdevs.thought
    monkeypatch.setattr(qgdevs.thought, "interpret_with_language_model", lambda *a, **k: called.append(1))
    r = client.post("/api/thought/interpret", json={"prompt": "two masses entangled", "language_model": "anthropic"})
    assert r.status_code == 200 and not called
    assert any("researcher token" in n for n in r.json()["domain_notes"])


def test_public_fetch_is_rate_limited_and_uses_default_query(client, monkeypatch):
    from qgdevs.jobs import JobStore
    st = JobStore()
    for x in st.list(500):  # free this visitor's public slots taken by earlier tests
        st.cancel(x["id"])
    monkeypatch.setenv("QGDEVS_API_TOKENS", "s3cret:researcher")
    body = {"type": "fetch_source", "params": {"connector": "zenodo", "kwargs": {"size": 10**6}}}
    r = client.post("/api/jobs", json=body)
    assert r.status_code == 200
    assert "kwargs" not in JobStore().get(r.json()["id"])["params"]
    assert client.post("/api/jobs", json=body).status_code == 429
    assert client.post("/api/jobs", json={"type": "fetch_source", "params": {"connector": "x"}}).status_code == 422


def test_cli_reproduce_matches_api_prediction(client, tmp_path, capsys):
    import json as _json
    from qgdevs import cli
    cfg = {"design": {"geometry": "linear", "time": 1.5}, "environment": {"pressure": 1e-14}}
    (tmp_path / "c.json").write_text(_json.dumps(cfg))
    assert cli.main(["reproduce", str(tmp_path / "c.json")]) == 0
    rerun = _json.loads(capsys.readouterr().out)
    api = client.post("/api/bmv/predict", json=cfg).json()
    assert set(rerun) == set(api)
    assert rerun["delta_phi_total_rad"] == api["delta_phi_total_rad"]
    assert rerun["time_series"]["negativity"] == api["time_series"]["negativity"]


def test_gates_require_actual_agreement_of_second_implementation(client, monkeypatch):
    import qgdevs.native
    r = client.post("/api/evidence/gates", json=SC).json()
    assert r["second_implementation"]["agrees"] == qgdevs.native.available()
    # a loadable kernel that disagrees must not count as an independent reproduction
    if qgdevs.native.available():
        real = qgdevs.native.bmv_point
        monkeypatch.setattr(qgdevs.native, "bmv_point", lambda d: {**real(d), "delta_phi": 1.0})
        r = client.post("/api/evidence/gates", json=SC).json()
        assert not r["second_implementation"]["agrees"]
        assert r["classification"]["level"] < 4


def test_simulated_witness_sign_is_fixed_by_protocol_not_by_true_model(client, monkeypatch):
    from qgdevs import models
    from qgdevs.design import Environment, scenario_for
    from qgdevs.discrimination import protocol_frame
    from qgdevs import quantum as qm, bmv
    scen, _ = scenario_for(bmv.BMVDesign(geometry="linear"), Environment())
    F = protocol_frame(scen)
    e = qm.pauli_expectations(F @ models.get("QG-COH").state(scen) @ F.conj().T)
    expected = -1 if 1 - e["XX"] + e["YZ"] + e["ZY"] < 1 - e["XX"] - e["YZ"] - e["ZY"] else 1
    # a data-generating model whose entangling phase has the opposite sign must not change the analysis
    qg = models.get("QG-COH")._state
    monkeypatch.setattr(models.get("SC-MF"), "_state", lambda sc, eta: qg(sc, eta).conj())
    for m in ("QG-COH", "SC-MF"):
        rec = client.post("/api/signal/simulate", json={**SC, "model": m, "shots": 200}).json()
        assert rec["witness_estimate"]["sign_variant"] == expected, m
