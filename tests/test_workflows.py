"""End-to-end acceptance tests required by the experimental-setup / thought-experiment directive and the
master specification (Part II §E, §21, §22)."""
import io
import json
import time
import zipfile

import numpy as np
import pytest

from qgdevs import bmv, lab, thought, sigproc, evidence, models, quantum as qm
from qgdevs.design import Environment, scenario_for, constraint_report, DesignBounds
from qgdevs.discrimination import predictions_table


@pytest.fixture
def ledger(tmp_path):
    return evidence.Ledger(tmp_path / "ledger.jsonl")


# --------------------------------------------------------------------- experimental dossiers
def test_dossier_contains_required_sections():
    d = lab.generate_dossier(bmv.BMVDesign(geometry="linear"))
    p, e = d["protocol"], d["engineering"]
    for key in ("1_objective", "2_background", "3_equations", "4_predictions", "5_initial_conditions", "6_procedure",
                "7_calibration", "8_uncertainty_budget", "9_decision_rules", "10_falsification", "11_replication"):
        assert key in p, key
    assert len(p["6_procedure"]) >= 8
    items = [b["item"] for b in e["bill_of_materials"]]
    assert any("Test masses" in i for i in items) and any("vacuum" in i.lower() for i in items)
    assert all(b["status"] in lab.__dict__.values() or b["status"] in d["status_legend"] for b in e["bill_of_materials"])
    assert all(b["cost"] == "quotation required" for b in e["bill_of_materials"])  # never invented
    assert e["geometry"]["branch_positions_m"] and e["tolerances"] and e["environmental_requirements"]
    assert e["safety"] and e["commissioning"]
    assert "CONCEPTUAL" in e["classification"] and "not an executed" in p["classification"]


def test_dossier_numbers_come_from_physics():
    d1 = lab.generate_dossier(bmv.BMVDesign(geometry="linear", time=2.5))
    d2 = lab.generate_dossier(bmv.BMVDesign(geometry="linear", time=1.0))
    p1 = d1["engineering"]["environmental_requirements"]["max_pressure"]["value"]
    p2 = d2["engineering"]["environmental_requirements"]["max_pressure"]["value"]
    assert p2 == pytest.approx(2.5 * p1, rel=1e-9)  # collisional budget Γt ≤ 0.1 ⇒ P_max ∝ 1/t
    assert d1["protocol"]["4_predictions"]["delta_phi_rad"]["status"] == lab.CALC


def test_infeasible_configurations_identified():
    overlapping = bmv.BMVDesign(separation=1e-6, dx_A=1e-6, dx_B=1e-6)
    assert bmv.check_geometry(overlapping)
    rep = constraint_report(bmv.BMVDesign(geometry="linear", separation=260e-6), Environment(), DesignBounds())
    assert not rep["feasible"]
    d = lab.generate_dossier(bmv.BMVDesign(geometry="linear"))
    assert not d["consistency_check"]["passed"]  # requirements exceed demonstrated capability (TRL < 4)
    assert d["engineering"]["technological_readiness"]["overall_trl"] < 4


def test_geometry_exports():
    des = bmv.BMVDesign()
    stl = lab.stl_ascii(des)
    assert stl.startswith("solid") and stl.count("facet normal") > 100
    assert "<svg" in lab.layout_svg(des)
    assert len(lab.scene_json(des)["objects"]) == 5


# --------------------------------------------------------------------- thought experiments & language model
PROMPT = ("What would happen if two massive quantum objects of 1e-14 kg were prepared in spatial superposition of "
          "250 um, separated by 450 um, allowed to interact gravitationally for 2.5 s, and then measured for entanglement?")


def test_thought_experiment_produces_reviewable_config():
    cfg = thought.interpret(PROMPT)
    assert cfg.family == "bmv" and cfg.interpreter == "deterministic"
    q = cfg.quantities
    assert q["mass"].si_value == pytest.approx(1e-14) and q["mass"].source == "USER_STATED"
    assert q["separation"].si_value == pytest.approx(450e-6)
    assert q["branch_separation"].si_value == pytest.approx(250e-6)
    assert q["time"].si_value == pytest.approx(2.5)
    assert any("Newtonian" in a for a in cfg.assumptions)
    json.dumps(cfg.as_dict())


def test_execution_requires_approval_and_uses_solvers():
    cfg = thought.interpret(PROMPT)
    with pytest.raises(PermissionError):
        thought.execute(cfg)
    cfg.approved = True
    out = thought.execute(cfg)
    ref = bmv.predict(thought.to_design(cfg))
    assert out["prediction"]["delta_phi_gravity_rad"] == pytest.approx(ref["delta_phi_gravity_rad"], rel=1e-12)
    assert out["prediction"]["delta_phi_total_rad"] != ref["delta_phi_total_rad"]  # Casimir channel included
    assert "not physical evidence" in out["evidence_status"]


def test_missing_and_speculative_inputs_flagged():
    cfg = thought.interpret("two masses in superposition become entangled by gravity?")
    assert set(cfg.missing) >= {"mass", "separation", "branch_separation", "time"}
    assert all(cfg.quantities[m].source == "DEFAULT_ASSUMPTION" for m in cfg.missing)
    spec = thought.interpret("What happens to entanglement inside a wormhole?")
    assert spec.family is None and spec.domain_notes
    spec.approved = True
    assert thought.execute(spec)["status"] == "NOT_COMPUTED"


def test_language_model_toggle(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    off = thought.interpret(PROMPT, language_model="off")
    on = thought.interpret(PROMPT, language_model="anthropic")
    assert off.interpreter == "deterministic"
    assert any("language model unavailable" in n for n in on.domain_notes)  # graceful fallback, still usable
    assert on.quantities["mass"].si_value == off.quantities["mass"].si_value


def test_language_model_output_is_validated_and_labelled():
    fake = {"family": "bmv", "category": "COMPUTATIONAL", "geometry": "linear", "material": "diamond",
            "quantities": [{"role": "mass", "value": 1e-14, "unit": "kg", "stated_by_user": True},
                           {"role": "time", "value": 3.0, "unit": "s", "stated_by_user": True}],
            "speculative": False, "clarifying_questions": ["What separation?"], "physical_question": "q"}
    cfg = thought._from_lm_json("two 1e-14 kg masses", fake, "test")
    assert cfg.quantities["mass"].source == "USER_STATED"
    assert cfg.quantities["time"].source == "LM_PROPOSED"  # '3' does not appear in the prompt
    assert "separation" in cfg.missing


# --------------------------------------------------------------------- no fabricated measurements
def test_synthetic_data_always_labelled():
    rho = bmv.joint_state({"LL": 0.1, "LR": 0.0, "RL": 0.0, "RR": 0.2})
    rec = sigproc.simulate_counts(rho, ["XX", "YZ", "ZY"], 100, sigproc.DetectorModel(), 1, "QG-COH")
    assert rec["data_label"] == "SYNTHETIC" and rec["sha256"]


def test_no_physical_claim_without_real_data(ledger):
    g = evidence.evaluate_gates(model_meta=models.get("QG-COH").meta, vv_report={"summary": {"failed": 0}},
                                lean_status={"theorems": [{"status": "proved"}]}, ledger=ledger,
                                dossier=lab.generate_dossier(bmv.BMVDesign(geometry="linear")),
                                second_implementation_match=True)
    st = {x["gate"]: x["status"] for x in g}
    assert st["G6"] == "NOT_PASSED" and st["G7"] == "NOT_PASSED"
    c = evidence.classify_evidence(g, independently_reproduced=True)
    assert not c["physical_claim_permitted"] and c["level"] < 6


def test_observables_linked_to_model_and_output():
    sc, _ = scenario_for(bmv.BMVDesign(geometry="linear"), Environment())
    for row in predictions_table(sc):
        rho = models.get(row["id"]).state(sc)
        assert row["negativity"] == pytest.approx(qm.negativity(rho), abs=1e-14)
    p = bmv.predict(bmv.BMVDesign())
    assert p["delta_phi_gravity_rad"] == pytest.approx(bmv.entangling_phase(p["phases_rad"]))
    assert p["design"]["mass_A"] == 1e-14


def test_classical_models_never_entangle_by_gravity():
    sc, _ = scenario_for(bmv.BMVDesign(geometry="linear"), Environment(include_casimir=False))
    for hid in ("SC-MF", "CC-KTM", "NULL-NG"):
        assert qm.negativity(models.get(hid).state(sc)) < 1e-12
    assert qm.negativity(models.get("QG-COH").state(sc)) > 0.01


# --------------------------------------------------------------------- evidence integrity
def test_preregistration_blind_vault(tmp_path, ledger):
    vault = evidence.BlindVault(tmp_path / "vault", ledger)
    rec = vault.ingest(b"secret counts", label="REAL", role="blind_test", source="lab", description="held out")
    with pytest.raises(PermissionError):
        vault.read(rec.dataset_id, "analysis")
    with pytest.raises(PermissionError):
        vault.read(rec.dataset_id, "calibration")
    with pytest.raises(PermissionError):
        vault.unblind(rec.dataset_id, "nonexistent")
    pr = evidence.preregister(ledger, title="t", hypotheses=["QG-COH"], design={}, predictions={"W": -0.2},
                              decision_rules={"z": 5}, analysis_plan="a", seeds=[0], sample_size={"n": 1},
                              nuisance_ranges={})
    vault.unblind(rec.dataset_id, pr["payload"]["prereg_id"])
    assert vault.read(rec.dataset_id, "analysis") == b"secret counts"
    with pytest.raises(PermissionError):
        vault.read(rec.dataset_id, "training")
    assert ledger.verify()["valid"]


def test_reproduction_package(ledger):
    z = zipfile.ZipFile(io.BytesIO(evidence.reproduction_package(config={"a": 1}, results={"b": 2}, ledger=ledger)))
    names = set(z.namelist())
    assert {"config.json", "results.json", "manifest.json", "README.txt", "SHA256SUMS"} <= names
    sums = dict(line.split("  ")[::-1] for line in z.read("SHA256SUMS").decode().splitlines())
    for n, h in sums.items():
        assert evidence.sha256_bytes(z.read(n)) == h


# --------------------------------------------------------------------- instruments
def test_instrument_safety(ledger):
    from qgdevs.instruments import default_simulated, SafetyError
    dev = default_simulated(ledger)
    with pytest.raises(SafetyError):
        dev.authorise("language-model", "x")
    auth = dev.authorise("Dr Operator", "commissioning")
    with pytest.raises(SafetyError):
        dev.command(None, "laser_power_mW", 1)
    with pytest.raises(SafetyError):
        dev.command(auth, "laser_power_mW", 50)  # above limit
    assert dev.command(auth, "laser_power_mW", 1)["status"] == "executed"
    dev.emergency_stop("Dr Operator")
    with pytest.raises(SafetyError):
        dev.command(auth, "laser_power_mW", 1)
    kinds = [e["kind"] for e in ledger.entries()]
    assert "instrument_estop" in kinds and kinds.count("instrument_command") >= 4


# --------------------------------------------------------------------- jobs
def test_job_queue_recovery(tmp_path, monkeypatch):
    from qgdevs import jobs
    st = jobs.JobStore(tmp_path / "jobs.db")
    jid = st.submit("vv_run", {"ids": ["S1-rabi"]})
    j = st.claim("w1")
    assert j["id"] == jid and st.get(jid)["status"] == "running"
    with st._c() as c:
        c.execute("update jobs set heartbeat=? where id=?", (time.time() - 1000, jid))
    assert st.recover_stale(60) == 1 and st.get(jid)["status"] == "queued"
    st.cancel(jid)
    assert st.get(jid)["status"] == "cancelled"


def test_backup_restore_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("QGDEVS_HOME", str(tmp_path / "home"))
    import importlib, qgdevs.jobs, qgdevs.backup
    importlib.reload(qgdevs.jobs); importlib.reload(qgdevs.backup)
    p = qgdevs.jobs.paths()
    qgdevs.jobs.JobStore().submit("vv_run", {})
    L = evidence.Ledger(p["ledger"]); L.append("note", {"x": 1})
    (p["vault"] / "abc").write_bytes(b"data")
    a = qgdevs.backup.snapshot(tmp_path / "bk")
    assert qgdevs.backup.verify(a)["valid"]
    r = qgdevs.backup.restore(a, tmp_path / "restored")
    assert r["ledger_chain"]["valid"] and (tmp_path / "restored" / "vault" / "abc").read_bytes() == b"data"
    importlib.reload(qgdevs.jobs)


def test_fast_lane_and_atomic_schedule(tmp_path):
    from qgdevs import jobs
    st = jobs.JobStore(tmp_path / "j.db")
    st.submit("calibration_tradeoff", {})
    fid = st.submit("dossier", {})
    assert st.claim("fast", jobs.FAST_TYPES)["id"] == fid
    assert st.schedule_due("x", 100) and not st.schedule_due("x", 100)


def test_backend_fixes_from_ui_testing():
    from qgdevs import inference as inf
    m = inf.CouplingModel(bmv.BMVDesign(geometry="linear"), qm.PAULI_SETTINGS)
    P = m.probabilities(np.array([1.0, 0.1, 0.0, 0.0]))
    counts = {s: np.round(P[k] * 500).astype(int).tolist() for k, s in enumerate(m.settings)}
    assert inf.adaptive_metropolis(m, counts, n_steps=900)["n_samples"] > 0
    charged = bmv.predict(bmv.BMVDesign(), extra_energies={k: 1e-20 for k in ("LL", "RR")} | {"LR": 0.0, "RL": 0.0})
    assert charged["warnings"]
    cfg = thought.interpret(PROMPT)
    cfg.approved = True
    out = thought.execute(cfg)
    qg = next(r for r in out["competing_models"] if r["id"] == "QG-COH")
    assert out["prediction"]["negativity"] == pytest.approx(qg["negativity"], rel=1e-6)


def test_csl_hypothesis_and_limits():
    from qgdevs.decoherence import csl_rate
    sc, _ = scenario_for(bmv.BMVDesign(geometry="linear"), Environment())
    csl = models.get("CSL-COLL")
    assert qm.negativity(csl.state(sc)) < 1e-12                       # GRW λ destroys BMV entanglement
    assert qm.negativity(csl.state(sc, {"csl_log10_lambda": -30})) == pytest.approx(
        qm.negativity(models.get("QG-COH").state(sc)), rel=1e-3)       # λ → 0 recovers QG-COH
    r1 = csl_rate(1e-14, 8.8e-7, 250e-6, 1.0)["rate"]
    assert csl_rate(1e-14, 8.8e-7, 250e-6, 1e-16)["rate"] == pytest.approx(1e-16 * r1, rel=1e-12)


def test_new_background_requirements():
    from qgdevs import em
    d = bmv.BMVDesign(geometry="linear")
    req = lab.generate_dossier(d)["engineering"]["environmental_requirements"]
    p = req["max_electric_dipole"]["value"]
    B = req["max_bias_field_during_interaction"]["value"]
    assert 0 < p < 1e-27 and 0 < B < 1e-2
    # at the limit the dipole channel uses at most the 0.05 rad budget along the worst axis tested
    E = em.diamagnetic_branch_energies(d, -2.2e-5, (0, 0, B))
    assert em._dphi_of(d, E) <= 0.05 * (1 + 1e-9)
    # the spin–spin coupling is always included in scenarios and is tiny here
    sc, extra = scenario_for(d, Environment())
    assert all("spin_dipolar" in v for v in extra["nongrav_channels"].values())


def test_recombination_requirement_monotone():
    from qgdevs import interferometry as itf
    a = itf.required_gradient_precision(1e-14, 250e-6, 0.25, 2 * np.pi * 100, 0)["max_relative_gradient_error"]
    b = itf.required_gradient_precision(1e-14, 250e-6, 0.25, 2 * np.pi * 100, 10)["max_relative_gradient_error"]
    assert 0 < b < a  # hotter motional state ⇒ tighter precision


def test_vault_reingest_identical_bytes(tmp_path, ledger):
    v = evidence.BlindVault(tmp_path / "v", ledger)
    a = v.ingest(b"same", label="SYNTHETIC", role="exploratory", source="s", description="d")
    b = v.ingest(b"same", label="SYNTHETIC", role="exploratory", source="s", description="d")
    assert a.sha256 == b.sha256


def test_discovery_returns_samples():
    from qgdevs.discovery import bmv_scaling_study
    r = bmv_scaling_study(n=16)
    assert len(r["samples"]["delta_phi"]) == 16
