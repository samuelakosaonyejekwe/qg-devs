"""Owner-requested policy: verifiable G6/G7, external ledger anchoring, token-bound identities, result retention."""
import importlib
import json
import os
import time

import pytest

from qgdevs import evidence, anchor


@pytest.fixture
def ledger(tmp_path):
    return evidence.Ledger(tmp_path / "ledger.jsonl")


def _signoff(ledger, gate, name, token_id, verified=True):
    ledger.append("human_signoff", {"gate": gate, "affiliation": "Lab", "statement": "assessed against prereg",
                                    "reviewer": name, "token_id": token_id, "identity_verified": verified}, name)


def _gates(ledger):
    return {g["gate"]: g for g in evidence.evaluate_gates(model_meta=None, vv_report=None, lean_status=None,
                                                         ledger=ledger, dossier=None)}


def test_g6_g7_pass_only_with_physical_evidence_and_independent_verified_signoffs(tmp_path, ledger):
    vault = evidence.BlindVault(tmp_path / "v", ledger)
    pr = evidence.preregister(ledger, title="t", hypotheses=["QG-COH"], design={}, predictions={}, decision_rules={},
                              analysis_plan="a", seeds=[0], sample_size={}, nuisance_ranges={})["payload"]["prereg_id"]
    alice = {"name": "Alice", "token_id": "aaa", "verified": True}
    bob = {"name": "Bob", "token_id": "bbb", "verified": True}
    rec = vault.ingest(b"raw instrument file", label="REAL", role="blind_test", source="lab A", description="d",
                       prereg_id=pr, actor="Alice", identity=alice)
    assert _gates(ledger)["G6"]["status"] == "NOT_PASSED"
    vault.unblind(rec.dataset_id, pr, "Alice")
    _signoff(ledger, "G6", "Mallory", None, verified=False)          # free-text sign-off: does not count
    assert _gates(ledger)["G6"]["status"] == "REQUIRES_HUMAN"
    _signoff(ledger, "G6", "Alice", "aaa")
    assert _gates(ledger)["G6"]["status"] == "PASSED"
    # replication from the SAME identity is not independent
    vault.ingest(b"replication by same lab", label="REAL", role="replication", source="lab A", description="d",
                 actor="Alice", identity=alice)
    _signoff(ledger, "G7", "Bob", "bbb")
    assert _gates(ledger)["G7"]["status"] != "PASSED"
    vault.ingest(b"replication by lab B", label="REAL", role="replication", source="lab B", description="d",
                 actor="Bob", identity=bob)
    _signoff(ledger, "G7", "Alice", "aaa")                             # G6 signer cannot also sign G7
    g7 = _gates(ledger)["G7"]
    assert g7["status"] == "PASSED"                                    # Bob's earlier G7 sign-off counts
    assert any("Bob" in x for x in g7["evidence"])


def test_anchor_detects_truncation_rewrite_and_forged_anchor(ledger):
    for i in range(5):
        ledger.append("note", {"i": i})
    a = anchor.publish(ledger, use_network=False)["anchor"]
    assert anchor.publish(ledger, use_network=False)["anchored"] is False   # head unchanged
    assert anchor.verify(ledger, [a])["valid"]
    lines = ledger.path.read_text().splitlines()
    ledger.path.write_text("\n".join(lines[:3]) + "\n")                       # drop the newest entries
    v = anchor.verify(ledger, [a])
    assert ledger.verify()["valid"] and not v["valid"] and "truncated" in v["anchor_problems"][0]["problem"]
    forged = dict(a, ledger_index=1)
    assert "altered" in anchor.verify(ledger, [forged])["anchor_problems"][0]["problem"]
    assert "malformed" in anchor.verify(ledger, [{"x": 1}])["anchor_problems"][0]["problem"]


def test_retention_expires_old_results_but_keeps_evidence(tmp_path, monkeypatch):
    monkeypatch.setenv("QGDEVS_HOME", str(tmp_path / "home"))
    import qgdevs.jobs as jobs
    importlib.reload(jobs)
    st = jobs.JobStore()
    old, ev, new = st.submit("vv_run", {}), st.submit("vv_run", {}), st.submit("vv_run", {})
    for jid in (old, ev, new):
        st.claim("w")
        (jobs.paths()["results"] / f"{jid}.json").write_text("{}")
    with st._c() as c:
        for jid in (old, ev, new):
            c.execute("update jobs set status='succeeded', result_path=?, finished=? where id=?",
                      (str(jobs.paths()["results"] / f"{jid}.json"),
                       "2020-01-01T00:00:00+00:00" if jid != new else jobs.utcnow(), jid))
    evidence.Ledger(jobs.paths()["ledger"]).append("analysis_result", {"job_id": ev})
    r = jobs.HANDLERS["retention"]({"days": 30}, None)
    assert r["expired"] == 1 and r["kept_as_evidence"] == 1
    assert not (jobs.paths()["results"] / f"{old}.json").exists()
    assert (jobs.paths()["results"] / f"{ev}.json").exists() and (jobs.paths()["results"] / f"{new}.json").exists()
    importlib.reload(jobs)


def test_signoff_identity_bound_to_token(tmp_path, monkeypatch):
    monkeypatch.setenv("QGDEVS_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("QGDEVS_API_TOKENS", "tok-alice:researcher:Dr Alice Example,tok-bob:researcher")
    import qgdevs.jobs, qgdevs.api
    importlib.reload(qgdevs.jobs); importlib.reload(qgdevs.api)
    from fastapi.testclient import TestClient
    c = TestClient(qgdevs.api.app)
    body = {"gate": "G1", "reviewer": "Somebody Else", "affiliation": "Uni", "statement": "derivation reviewed in full"}
    assert c.post("/api/evidence/signoff", json=body).status_code == 401
    e = c.post("/api/evidence/signoff", json=body, headers={"Authorization": "Bearer tok-alice"}).json()
    assert e["actor"] == "Dr Alice Example" and e["payload"]["reviewer"] == "Dr Alice Example"
    assert e["payload"]["identity_verified"] and len(e["payload"]["token_id"]) == 12
    assert e["payload"]["claimed_reviewer_ignored"] == "Somebody Else"
    assert "tok-alice" not in json.dumps(e)
    a = c.get("/api/evidence/anchors").json()
    assert a["verification"]["chain_valid"]
    assert c.post("/api/evidence/verify-anchors", json={"anchors": [{"bad": 1}]}).json()["valid"] is False
    importlib.reload(qgdevs.jobs); importlib.reload(qgdevs.api)


def test_whoami_reports_identity_without_token(tmp_path, monkeypatch):
    monkeypatch.setenv("QGDEVS_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("QGDEVS_API_TOKENS", "tok-a:researcher:Dr A")
    import qgdevs.jobs, qgdevs.api
    importlib.reload(qgdevs.jobs); importlib.reload(qgdevs.api)
    from fastapi.testclient import TestClient
    c = TestClient(qgdevs.api.app)
    assert c.get("/api/auth/whoami").json()["role"] == "public"
    w = c.get("/api/auth/whoami", headers={"Authorization": "Bearer tok-a"}).json()
    assert w["name"] == "Dr A" and w["can_write_evidence"] and "tok-a" not in json.dumps(w)
    assert c.get("/api/auth/whoami", headers={"Authorization": "Bearer nope"}).status_code == 403
    importlib.reload(qgdevs.jobs); importlib.reload(qgdevs.api)
