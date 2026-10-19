"""Regression tests for defects found in the backend audit (one test per defect; each failed before its fix)."""
import io
import json
import multiprocessing as mp
import sqlite3
import tarfile
import threading
import time
import zipfile

import numpy as np
import pytest

from qgdevs import bmv, evidence, models


# --------------------------------------------------------------------------------------------- physics
def test_optomech_unequal_mass_self_terms_match_exact_hessian():
    """The trap softening of each mode must be −G m_A m_B x_X²/d³ for unequal masses too (was g for both)."""
    from qgdevs import optomech as om
    from qgdevs.constants import G, hbar
    mA, mB, d, w = 1e-3, 7e-3, 1e-3, 0.1  # strong coupling (g/ω ~ 1e-3) so the self-terms are resolvable
    g = om.gravitational_coupling_rate(mA, mB, d, w)
    A = om._drift(w, g, 0.0, g * np.sqrt(mB / mA), g * np.sqrt(mA / mB))
    # exact quadratic Hamiltonian in (x_A, p_A, x_B, p_B): traps + second-order expansion of −G mA mB/|d + xB − xA|
    k = G * mA * mB / d**3
    Hxx = np.array([[mA * w**2 - 2 * k, 2 * k], [2 * k, mB * w**2 - 2 * k]])  # ∂²V/∂x_i∂x_j
    xz = np.sqrt(hbar / (2 * np.array([mA, mB]) * w))
    # in quadratures X = x/(√2 x_zpf): dP/dt = −(1/ħ) ∂H/∂X = −(2 x_zpf_i x_zpf_j / ħ) Hxx X
    K = 2 * np.outer(xz, xz) * Hxx / hbar
    exact = np.zeros((4, 4))
    exact[0, 1] = exact[2, 3] = w
    exact[1, 0], exact[1, 2], exact[3, 0], exact[3, 2] = -K[0, 0], -K[0, 1], -K[1, 0], -K[1, 1]
    np.testing.assert_allclose(A, exact, rtol=1e-12, atol=1e-12 * w)
    # the gravitational parts (trap softening, coupling) are ~1e-13 ω here: compare them on their own scale
    soft = lambda M: np.array([M[1, 0] + w, M[3, 2] + w, M[1, 2], M[3, 0]])  # noqa: E731
    np.testing.assert_allclose(soft(A), soft(exact), rtol=1e-9)
    # the old construction (shift g on both modes) is wrong for unequal masses
    assert not np.allclose(soft(om._drift(w, g, 0.0, g)), soft(exact), rtol=1e-3)


def test_optomech_reports_dynamic_instability():
    from qgdevs import optomech as om
    ok = om.evolve_coupled_oscillators(1e-14, 1e-14, 1e-4, 2 * np.pi, 0.0, 0.0, 0.0, 1.0, 5)
    assert ok["dynamically_stable"]
    g1 = om.gravitational_coupling_rate(1e-14, 1e-14, 1e-4, 2 * np.pi)
    bad = om.evolve_coupled_oscillators(1e-14, 1e-14, 1e-4, 2 * np.pi, 0.0, 0.0, 0.0, 1e-3, 5,
                                        coupling_scale=2 * np.pi / g1)  # g = ω: relative mode anti-trapped
    assert not bad["dynamically_stable"]


def test_sg_phases_support_angled_geometry():
    """Angled designs were silently computed as linear in the API and dossier."""
    from qgdevs import interferometry as itf
    args = (1e-14, 1e-14, 450e-6, 0.25, 2.5, 250e-6)
    lin = itf.sg_bmv_phases(*args, "linear")["delta_phi"]
    par = itf.sg_bmv_phases(*args, "parallel")["delta_phi"]
    assert itf.sg_bmv_phases(*args, "angled", angle_deg=0.0)["delta_phi"] == pytest.approx(lin, rel=1e-12)
    assert itf.sg_bmv_phases(*args, "angled", angle_deg=90.0)["delta_phi"] == pytest.approx(par, rel=1e-12)
    a45 = itf.sg_bmv_phases(*args, "angled", angle_deg=45.0)["delta_phi"]
    assert a45 != pytest.approx(lin, rel=1e-3) and a45 != pytest.approx(par, rel=1e-3)
    with pytest.raises(ValueError):
        itf.sg_bmv_phases(*args, "diagonal")


@pytest.mark.parametrize("hid,key", [("DP-COLL", None), ("CSL-COLL", "csl_log10_lambda")])
def test_collapse_rates_scale_with_mass_calibration(hid, key):
    """mass_scale multiplies the gravitational energies by s²; the collapse rates (∝ m² at fixed R) must too."""
    from qgdevs.decoherence import csl_rate, diosi_penrose_rate
    d = bmv.BMVDesign(geometry="linear", mass_A=1e-15, mass_B=1e-15)
    sc = models.Scenario(d, 0.0, 0.0)
    s = 1.01
    eta = {"mass_scale": s, **({key: -20.0} if key else {})}
    if hid == "DP-COLL":
        G0 = diosi_penrose_rate(d.mass_A, d.radius_A, d.dx_A)["rate"]
    else:
        G0 = 1e-20 * csl_rate(d.mass_A, d.radius_A, d.dx_A, 1.0)["rate"]
    ph = bmv.phases_from_energies(sc.grav_energies(s), d.time)
    expected = bmv.joint_state(ph, s**2 * G0 * d.time, s**2 * G0 * d.time)
    np.testing.assert_allclose(models.get(hid).state(sc, eta), expected, rtol=0, atol=1e-13)


def test_user_decoherence_rates_are_not_discarded():
    from qgdevs.design import Environment, full_prediction, scenario_for
    d0 = bmv.BMVDesign(geometry="linear")
    d1 = bmv.BMVDesign(geometry="linear", gamma_A=0.3, gamma_B=0.1)
    s0, _ = scenario_for(d0, Environment())
    s1, _ = scenario_for(d1, Environment())
    assert s1.gamma_env_A == pytest.approx(s0.gamma_env_A + 0.3) and s1.gamma_env_B == pytest.approx(s0.gamma_env_B + 0.1)
    p = full_prediction(d1, Environment())
    assert p["design"]["gamma_A"] == 0.3  # input echoed unchanged: re-feeding it does not double count
    assert p["total_decoherence_rate_A"] == pytest.approx(s1.gamma_env_A)


def test_check_geometry_rejects_nan_inf_and_negative_ints():
    assert bmv.check_geometry(bmv.BMVDesign(separation=float("nan")))
    assert bmv.check_geometry(bmv.BMVDesign(time=float("inf")))
    assert any("gamma_A" in i for i in bmv.check_geometry(bmv.BMVDesign(gamma_A=-1)))  # int, as JSON sends it
    assert bmv.check_geometry(bmv.BMVDesign(geometry="diagonal"))
    assert not bmv.check_geometry(bmv.BMVDesign(time=2))


def test_sweeps_reject_unknown_parameters():
    from qgdevs.design import Environment, sweep_1d, sweep_2d
    with pytest.raises(ValueError):
        sweep_1d(bmv.BMVDesign(), Environment(), "foo", [1.0])  # used to return the unchanged design silently
    with pytest.raises(ValueError):
        sweep_2d(bmv.BMVDesign(), Environment(), "separation", [4e-4], "geometry", [1.0])


def test_max_charge_root_at_bracket_end(monkeypatch):
    """A root lying exactly at the last bracket point (1e12 e) was reported as 'no limit' (inf)."""
    from qgdevs import em
    from qgdevs.constants import e as e_charge, hbar
    d = bmv.BMVDesign(geometry="linear")
    budget = 0.05

    def fake(design, cmA, cmB, qA, qB, include=()):  # |Δφ| = budget · (n/1e12)²
        n = qA / e_charge
        return {"LL": {"c": -hbar * budget * (n / 1e12) ** 2 / design.time}, "LR": {"c": 0.0},
                "RL": {"c": 0.0}, "RR": {"c": 0.0}}
    monkeypatch.setattr(em, "branch_energies", fake)
    assert em.max_charge_for(d, budget, 0.5) == pytest.approx(1e12, rel=1e-9)


def test_nbody_energy_vectorised_matches_pairwise_sum():
    from qgdevs import gravity as gr
    from qgdevs.constants import G
    rng = np.random.default_rng(0)
    pos, vel, m = rng.normal(size=(7, 3)), rng.normal(size=(7, 3)), rng.uniform(1, 2, 7)
    ref = 0.5 * np.sum(m * np.sum(vel**2, 1)) - sum(G * m[i] * m[j] / np.linalg.norm(pos[i] - pos[j])
                                                    for i in range(7) for j in range(i + 1, 7))
    assert gr.nbody_energy(pos, vel, m) == pytest.approx(ref, rel=1e-13)


def test_injection_recovery_allows_every_placement():
    from qgdevs.sigproc import injection_recovery
    tpl = np.ones(10)
    r = injection_recovery(tpl, [1.0], n_samples=10, noise_sigma=1.0, threshold=1.0, trials=3)  # raised before
    assert r["trials"] == 3


def test_amu_unit_uses_codata_constant():
    from qgdevs import constants, units
    assert units.to_si(1.0, "amu")[0] == constants.u and units.to_si(1.0, "u")[0] == constants.u


def test_near_field_discovery_status_is_checked():
    from qgdevs.discovery import run_discovery_cycle
    import tempfile, pathlib
    with tempfile.TemporaryDirectory() as td:
        recs = run_discovery_cycle(evidence.Ledger(pathlib.Path(td) / "l.jsonl"))
    near = recs[1]["payload"]
    assert set(near["checks"]["rel_error_leading_coefficients"]) == {"u^1", "u^2"}
    assert (near["status"] == "VERIFIED_AGAINST_KNOWN_LAW") == (
        near["checks"]["rel_error_leading_coefficients"]["u^1"] < 1e-3
        and near["checks"]["rel_error_leading_coefficients"]["u^2"] < 1e-2)


def test_calibration_study_does_not_mutate_shared_registry():
    from qgdevs.discovery import calibration_tradeoff_study
    before = [n.__dict__.copy() for n in models.COMMON_NUISANCE]
    seen = []

    def watch():
        while not done.is_set():
            seen.append(models.COMMON_NUISANCE[0].high)
            time.sleep(0.001)
    done = threading.Event()
    t = threading.Thread(target=watch)
    t.start()
    try:
        r = calibration_tradeoff_study(n=1, seed=1)
    finally:
        done.set()
        t.join()
    assert [n.__dict__ for n in models.COMMON_NUISANCE] == before
    assert set(seen) == {before[0]["high"]}  # other threads never observe a modified nuisance range
    assert r["rows"] and r["max_rel_diff"] < 0.05


# --------------------------------------------------------------------------------------------- ledger & vault
def _append_many(path, i):
    L = evidence.Ledger(path)
    for k in range(40):
        L.append("x", {"i": i, "k": k})


def test_ledger_concurrent_appends_keep_chain_valid(tmp_path):
    ps = [mp.get_context("fork").Process(target=_append_many, args=(tmp_path / "l.jsonl", i)) for i in range(4)]
    [p.start() for p in ps]
    [p.join() for p in ps]
    v = evidence.Ledger(tmp_path / "l.jsonl").verify()
    assert v["valid"] and v["length"] == 160


def test_ledger_detects_deleted_and_reindexed_entries(tmp_path):
    L = evidence.Ledger(tmp_path / "l.jsonl")
    for k in range(3):
        L.append("x", {"k": k})
    lines = L.path.read_text().splitlines()
    e = json.loads(lines[0])
    e["index"] = 5
    L.path.write_text("\n".join([json.dumps(e)] + lines[1:]) + "\n")
    assert not L.verify()["valid"]


def test_vault_refuses_reingestion_under_another_role(tmp_path):
    L = evidence.Ledger(tmp_path / "l.jsonl")
    v = evidence.BlindVault(tmp_path / "v", L)
    v.ingest(b"x", label="REAL", role="exploratory", source="s", description="")
    with pytest.raises(ValueError):
        v.ingest(b"x", label="REAL", role="blind_test", source="s", description="")
    # and the reverse order: sealed first, then an unsealed copy that would bypass the seal
    rec = v.ingest(b"y", label="REAL", role="blind_test", source="s", description="")
    with pytest.raises(ValueError):
        v.ingest(b"y", label="REAL", role="exploratory", source="s", description="")
    with pytest.raises(PermissionError):
        v.read(rec.dataset_id, "analysis")


def test_unblinding_is_bound_to_the_ingestion_preregistration(tmp_path):
    L = evidence.Ledger(tmp_path / "l.jsonl")
    kw = dict(hypotheses=[], design={}, predictions={}, decision_rules={}, analysis_plan="", seeds=[],
              sample_size={}, nuisance_ranges={})
    p1 = evidence.preregister(L, title="a", **kw)["payload"]["prereg_id"]
    p2 = evidence.preregister(L, title="b", **kw)["payload"]["prereg_id"]
    v = evidence.BlindVault(tmp_path / "v", L)
    with pytest.raises(ValueError):
        v.ingest(b"z", label="REAL", role="blind_test", source="s", description="", prereg_id="nope")
    rec = v.ingest(b"z", label="REAL", role="blind_test", source="s", description="", prereg_id=p1)
    with pytest.raises(PermissionError):
        v.unblind(rec.dataset_id, p2)
    v.unblind(rec.dataset_id, p1)


def test_gate_g5_not_passed_with_tampered_ledger(tmp_path):
    L = evidence.Ledger(tmp_path / "l.jsonl")
    evidence.preregister(L, title="t", hypotheses=[], design={}, predictions={}, decision_rules={},
                         analysis_plan="", seeds=[], sample_size={}, nuisance_ranges={})
    st = {g["gate"]: g["status"] for g in evidence.evaluate_gates(model_meta=None, vv_report=None, lean_status=None,
                                                                  ledger=L, dossier=None)}
    assert st["G5"] == "PASSED"
    e = json.loads(L.path.read_text())
    e["payload"]["title"] = "edited"
    L.path.write_text(json.dumps(e) + "\n")
    st = {g["gate"]: g["status"] for g in evidence.evaluate_gates(model_meta=None, vv_report=None, lean_status=None,
                                                                  ledger=L, dossier=None)}
    assert st["G5"] == "NOT_PASSED"


@pytest.mark.parametrize("report", [{"summary": {"failed": 0}}, {"summary": {"total": 0, "failed": 0}},
                                    {"summary": {"total": 1, "failed": 0}, "scope": "partial"}])
def test_gate_g3_rejects_vacuous_or_partial_verification(report):
    g = evidence.evaluate_gates(model_meta=None, vv_report=report, lean_status=None, ledger=None, dossier=None)
    assert {x["gate"]: x["status"] for x in g}["G3"] == "NOT_PASSED"


def test_vv_unknown_ids_fail():
    from qgdevs import vv
    r = vv.run(["no-such-benchmark"])
    assert r["summary"] == {"total": 1, "passed": 0, "failed": 1} and r["scope"] == "partial"
    assert vv.run(["S1-rabi"])["results"][0]["reference_value"] == 0.0


# --------------------------------------------------------------------------------------------- backups
@pytest.fixture
def home(tmp_path, monkeypatch):
    import qgdevs.jobs
    monkeypatch.setattr(qgdevs.jobs, "HOME", tmp_path / "home")
    return qgdevs.jobs.paths()


def test_backup_consistent_while_ledger_is_appended(home, tmp_path):
    import qgdevs.backup as bk
    L = evidence.Ledger(home["ledger"])
    stop = threading.Event()

    def writer():
        while not stop.is_set():
            L.append("note", {"x": "y" * 2000})
    t = threading.Thread(target=writer)
    t.start()
    try:
        archives = [bk.snapshot(tmp_path / "bk") for _ in range(5)]
    finally:
        stop.set()
        t.join()
    for a in archives:
        assert bk.verify(a)["valid"]


def test_restore_extracts_only_verified_members_and_drops_stale_wal(home, tmp_path):
    import qgdevs.backup as bk
    evidence.Ledger(home["ledger"]).append("note", {"x": 1})
    from qgdevs.jobs import JobStore
    JobStore().submit("vv_run", {})
    a = bk.snapshot(tmp_path / "bk")
    # tamper: add a member that the manifest does not list
    evil = tmp_path / "evil.tar.gz"
    with tarfile.open(a, "r:gz") as src, tarfile.open(evil, "w:gz") as dst:
        for m in src.getmembers():
            dst.addfile(m, src.extractfile(m))
        data = b"planted"
        info = tarfile.TarInfo("vault/planted")
        info.size = len(data)
        dst.addfile(info, io.BytesIO(data))
    v = bk.verify(evil)
    assert not v["valid"] and v["unlisted"] == ["vault/planted"]
    with pytest.raises(RuntimeError):
        bk.restore(evil, tmp_path / "r1")
    target = tmp_path / "r2"
    target.mkdir()
    (target / "jobs.db-wal").write_bytes(b"stale wal from the replaced database")
    bk.restore(a, target)
    assert not (target / "jobs.db-wal").exists()
    with sqlite3.connect(target / "jobs.db") as c:
        assert c.execute("select count(*) from jobs").fetchone()[0] == 1


# --------------------------------------------------------------------------------------------- jobs
def test_submit_limited_is_atomic_across_threads(tmp_path):
    from qgdevs.jobs import JobStore, QueueLimit
    st = JobStore(tmp_path / "j.db")
    ok, refused = [], []

    def go():
        try:
            ok.append(JobStore(tmp_path / "j.db").submit_limited("vv_run", {"_client": "c"}, "c", 3, 40))
        except QueueLimit:
            refused.append(1)
    ts = [threading.Thread(target=go) for _ in range(12)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(ok) == 3 and len(refused) == 9 and st.stats()["queued"] == 3


def test_stale_worker_cannot_finish_a_reclaimed_job(tmp_path):
    from qgdevs.jobs import JobStore
    st = JobStore(tmp_path / "j.db")
    jid = st.submit("vv_run", {})
    st.claim("w1")
    with st._c() as c:
        c.execute("update jobs set heartbeat=0 where id=?", (jid,))
    st.recover_stale(60)
    st.claim("w2")
    assert not st.finish(jid, "failed", error="late", worker="w1")
    assert st.get(jid)["status"] == "running"
    assert st.finish(jid, "succeeded", worker="w2")


def test_cancel_honoured_for_handlers_without_progress(tmp_path, monkeypatch):
    from qgdevs import jobs
    monkeypatch.setattr(jobs, "HOME", tmp_path)
    st = jobs.JobStore(tmp_path / "j.db")
    jobs.HANDLERS["_test_silent"] = lambda p, ctx: st.cancel(ctx.jid) or {"done": True}
    try:
        jid = st.submit("_test_silent", {})
        jobs.run_job(st, st.claim("w"))
        assert st.get(jid)["status"] == "cancelled"
    finally:
        jobs.HANDLERS.pop("_test_silent")


def test_public_job_parameters_are_capped():
    from qgdevs.jobs import sanitize_public_params
    p = sanitize_public_params("design_optimise", {"maxiter": 10**9, "popsize": 10**6})
    assert p == {"maxiter": 40, "popsize": 15}
    assert sanitize_public_params("inference", {"n_steps": 10**9})["n_steps"] == 20000
    assert "kwargs" not in sanitize_public_params("fetch_source", {"connector": "arxiv", "kwargs": {"max_results": 10**6}})
    with pytest.raises(ValueError):
        sanitize_public_params("design_optimise", {"maxiter": "x"})


# --------------------------------------------------------------------------------------------- data parsing
def test_npz_decompression_bomb_refused():
    from qgdevs.data import parse_upload
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        hdr = io.BytesIO()
        np.lib.format.write_array_header_1_0(hdr, {"descr": "<f8", "fortran_order": False, "shape": (40_000_000,)})
        with z.open("a.npy", "w", force_zip64=True) as f:
            f.write(hdr.getvalue())
            zeros = bytes(1 << 20)
            for _ in range(320):
                f.write(zeros)
    assert len(buf.getvalue()) < 2_000_000
    with pytest.raises(ValueError, match="limit"):
        parse_upload("bomb.npz", buf.getvalue())


def test_matrix_market_huge_header_refused():
    from qgdevs.data import parse_upload
    mtx = b"%%MatrixMarket matrix coordinate real general\n1000000 1000000 1\n1 1 1.0\n"
    with pytest.raises(ValueError, match="limit"):
        parse_upload("m.mtx", mtx)
    ok = parse_upload("m.mtx", b"%%MatrixMarket matrix coordinate real general\n2 2 1\n1 1 1.0\n")
    assert ok["content"].shape == (2, 2)


def test_density_matrix_validation_bounds():
    from qgdevs.data import validate_density_matrix
    assert not validate_density_matrix(np.full((2, 2), np.nan))["passed"]


# --------------------------------------------------------------------------------------------- native & instruments
def test_native_wrappers_validate_shapes():
    from qgdevs import native
    if not native.available():
        pytest.skip("native library not built")
    with pytest.raises(ValueError):
        native.purity(np.zeros((4, 2)))  # the kernel would read 16 entries from an 8-entry buffer
    with pytest.raises(ValueError):
        native.nbody_energy(np.zeros((3, 3)), np.zeros((2, 3)), np.ones(3))
    with pytest.raises(ValueError):
        native.eigvalsh(np.zeros((0, 0)))
    assert native.purity(np.eye(2) / 2) == pytest.approx(0.5)


def test_instrument_refuses_forged_authorisation(tmp_path):
    from qgdevs.instruments import Authorisation, SafetyError, default_simulated
    dev = default_simulated(evidence.Ledger(tmp_path / "l.jsonl"))
    forged = Authorisation("Dr Nobody", dev.device_id, "x", time.time(), time.time() + 3600)
    with pytest.raises(SafetyError):
        dev.command(forged, "laser_power_mW", 1)
    real = dev.authorise("Dr Operator", "test")
    assert dev.command(real, "laser_power_mW", 1)["status"] == "executed"
    other = default_simulated(evidence.Ledger(tmp_path / "l2.jsonl"))
    with pytest.raises(SafetyError):  # issued by another adapter instance
        other.command(real, "laser_power_mW", 1)


def test_matlab_bridge_whitelists_geometry():
    from qgdevs import matlab_bridge
    with pytest.raises(ValueError):
        matlab_bridge.bmv_entangling_phase(1e-14, 1e-14, 4.5e-4, 2.5e-4, 2.5, "parallel'); system('id")


def test_thought_quantities_are_range_checked():
    from qgdevs import thought
    cfg = thought.interpret("two coupled oscillators of 1e-14 kg 100 um apart")
    cfg.quantities["frequency"] = thought.Quantity("frequency", 1e9, "rad/s", 1e9, "USER_STATED")
    cfg.approved = True
    out = thought.execute(cfg)  # previously integrated 1e11 rad of dynamics (hours of CPU)
    assert out["status"] == "NOT_COMPUTED" and "frequency" in out["reason"]


def test_gas_collision_regime_flagged_for_small_superpositions():
    from qgdevs.decoherence import gas_collision_rate
    assert gas_collision_rate(1e-6, 1e-15, 1.0, dx=250e-6)["regime"].startswith("saturated")
    assert gas_collision_rate(1e-6, 1e-15, 1.0, dx=1e-11)["regime"].startswith("NOT saturated")


def _open_store_and_work(path, q, ev):
    from qgdevs.jobs import JobStore
    ev.wait()
    try:
        st = JobStore(path)
        for _ in range(15):
            st.claim("w")
            st.schedule_due("x", 0)
            st.submit("dossier", {})
        q.put("ok")
    except Exception as e:  # noqa: BLE001
        q.put(repr(e))


def test_jobstore_concurrent_startup_does_not_crash(tmp_path):
    """Workers and API processes starting together crashed with 'database is locked' on the WAL switch."""
    ctx = mp.get_context("fork")
    bad = []
    for trial in range(4):
        q, ev = ctx.Queue(), ctx.Event()
        ps = [ctx.Process(target=_open_store_and_work, args=(tmp_path / f"j{trial}.db", q, ev)) for _ in range(6)]
        [p.start() for p in ps]
        time.sleep(0.2)
        ev.set()
        [p.join() for p in ps]
        bad += [r for r in (q.get() for _ in ps) if r != "ok"]
    assert not bad, bad[:2]


def test_design_optimisation_can_be_cancelled_between_generations():
    from qgdevs.design import optimise
    calls = []

    def progress(frac, msg):
        calls.append(msg)
        if len(calls) == 2:
            raise InterruptedError("cancelled by user")
    with pytest.raises(InterruptedError):
        optimise(maxiter=50, popsize=3, robust_check=False, progress=progress)
    assert calls == ["generation 1/50", "generation 2/50"]


@pytest.mark.parametrize("kw", [{}, {"dx_A": 1e-3, "dx_B": 1e-3}, {"geometry": "linear"},
                                {"geometry": "angled", "angle_deg": 80, "dx_A": 2e-3, "dx_B": 2e-3}])
def test_layout_svg_keeps_every_branch_inside_the_drawing(kw):
    import re
    from qgdevs import lab
    svg = lab.layout_svg(bmv.BMVDesign(**kw))
    w, h = map(float, re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', svg).groups())
    for cx, cy, r in re.findall(r'<circle cx="([-0-9.]+)" cy="([-0-9.]+)" r="([0-9.]+)"', svg):
        cx, cy, r = float(cx), float(cy), float(r)
        assert r <= cx <= w - r and 30 <= cy - r and cy + r <= h - 40, (kw, cx, cy)
