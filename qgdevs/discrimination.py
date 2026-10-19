"""Suite 12 (engine) — theory-neutral discrimination of competing hypotheses.

For hypotheses H_true and H_alt the engine computes the *robust* per-shot information
    D(H_true ‖ H_alt) = min_{η_alt ∈ admissible}  (1/S) Σ_s KL( p_s(y | H_true, η⁰) ‖ p_s(y | H_alt, η_alt) )
over the S measurement settings of the protocol, i.e. after the alternative is allowed to adjust all
of its physically permitted nuisance parameters (spec Part II §B). The expected log Bayes factor in
favour of H_true after N shots per setting is ≈ N·S·D, so the number of shots needed for a target
log-evidence is N = ln B / (S·D). D = 0 means the models are observationally equivalent for this
design and measurement chain, and the engine says so explicitly.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize

from . import bmv, quantum as qm
from .models import Hypothesis, Scenario, HYPOTHESES

TOMOGRAPHY_SETTINGS = qm.PAULI_SETTINGS
WITNESS_SETTINGS = ["XX", "YZ", "ZY"]


@dataclass
class MeasurementChain:
    settings: tuple[str, ...] = tuple(TOMOGRAPHY_SETTINGS)
    readout_error_A: float = 0.01
    readout_error_B: float = 0.01
    frame: np.ndarray | None = None   # local unitary applied before measurement (protocol-fixed)

    def probabilities(self, rho: np.ndarray) -> np.ndarray:
        if self.frame is not None:
            rho = self.frame @ rho @ self.frame.conj().T
        V = qm.setting_vectors(self.settings)
        Ma = np.array([[1 - self.readout_error_A, self.readout_error_A], [self.readout_error_A, 1 - self.readout_error_A]])
        Mb = np.array([[1 - self.readout_error_B, self.readout_error_B], [self.readout_error_B, 1 - self.readout_error_B]])
        return qm.outcome_probabilities_all(rho, V) @ np.kron(Ma, Mb).T


def protocol_frame(sc: Scenario) -> np.ndarray:
    """Local Z corrections fixed in advance from the *nominal* gravitational local phases.

    The frame is part of the preregistered protocol; it is identical for every hypothesis tested,
    so it cannot favour any of them.
    """
    ph = bmv.phases_from_energies(sc.grav_energies(), sc.design.time)
    return bmv.local_phase_correction(ph)


def kl(p: np.ndarray, q: np.ndarray) -> float:
    p = np.clip(p, 1e-300, None)
    q = np.clip(q, 1e-300, None)
    return float(np.sum(np.where(p > 1e-300, p * np.log(p / q), 0.0)))


def robust_divergence(h_true: Hypothesis, h_alt: Hypothesis, sc: Scenario, chain: MeasurementChain,
                      eta_true: dict | None = None, restarts: int = 4, seed: int = 0) -> dict:
    p_true = chain.probabilities(h_true.state(sc, eta_true))
    nuis = h_alt.nuisance
    lo = np.array([n.low for n in nuis])
    hi = np.array([n.high for n in nuis])
    names = [n.name for n in nuis]

    def obj(x):
        eta = dict(zip(names, lo + (hi - lo) * (np.sin(x) ** 2)))
        q = chain.probabilities(h_alt.state(sc, eta))
        return kl(p_true, q) / len(chain.settings)

    rng = np.random.default_rng(seed)
    x_nom = np.arcsin(np.sqrt(np.clip((np.array([n.nominal for n in nuis]) - lo) / (hi - lo), 0, 1)))
    best = None
    for x0 in [x_nom] + [rng.uniform(0, np.pi / 2, len(nuis)) for _ in range(restarts)]:
        r = minimize(obj, x0, method="Nelder-Mead", options={"xatol": 1e-6, "fatol": 1e-16, "maxiter": 4000})
        if best is None or r.fun < best.fun:
            best = r
    eta_best = dict(zip(names, (lo + (hi - lo) * np.sin(best.x) ** 2).tolist()))
    at_bound = [k for k, v, n in zip(names, eta_best.values(), nuis)
                if np.isclose(v, n.low, rtol=1e-3) or np.isclose(v, n.high, rtol=1e-3)]
    return {"D_per_shot": max(float(best.fun), 0.0), "best_alt_nuisance": eta_best,
            "nuisance_at_bounds": at_bound}


def shots_required(D: float, n_settings: int, ln_bayes_target: float = np.log(150.0)) -> float:
    """Shots per setting so that the expected ln Bayes factor reaches ln_bayes_target (Kass–Raftery 'very strong': B=150)."""
    if D <= 1e-15:
        return float("inf")
    return float(ln_bayes_target / (n_settings * D))


def discrimination_matrix(sc: Scenario, hypothesis_ids: list[str] | None = None,
                          chain: MeasurementChain | None = None, ln_bayes_target: float = np.log(150.0),
                          max_feasible_shots: float = 1e6) -> dict:
    """Pairwise robust distinguishability of all implemented hypotheses for one design."""
    ids = hypothesis_ids or [h for h, v in HYPOTHESES.items() if v.implemented]
    chain = chain or MeasurementChain()
    if chain.frame is None:
        chain.frame = protocol_frame(sc)
    hs = [HYPOTHESES[i] for i in ids]
    rows = []
    for ht in hs:
        for ha in hs:
            if ht.id == ha.id:
                continue
            r = robust_divergence(ht, ha, sc, chain)
            n = shots_required(r["D_per_shot"], len(chain.settings), ln_bayes_target)
            rows.append({"true": ht.id, "alternative": ha.id, **r, "shots_per_setting": n,
                         "verdict": ("indistinguishable" if not np.isfinite(n) else
                                     "distinguishable" if n <= max_feasible_shots else
                                     "distinguishable in principle; exceeds shot budget")})
    return {"hypotheses": ids, "settings": list(chain.settings), "ln_bayes_target": ln_bayes_target,
            "max_feasible_shots": max_feasible_shots, "pairs": rows}


def predictions_table(sc: Scenario, hypothesis_ids: list[str] | None = None) -> list[dict]:
    """Observable predictions (entanglement, witness, coherence) of each hypothesis at nominal nuisance."""
    ids = hypothesis_ids or [h for h, v in HYPOTHESES.items() if v.implemented]
    frame = protocol_frame(sc)
    out = []
    for i in ids:
        rho = HYPOTHESES[i].state(sc)
        rc = frame @ rho @ frame.conj().T
        out.append({"id": i, "negativity": qm.negativity(rho), "concurrence": qm.concurrence(rho),
                    "witness_cpk": bmv.cpk_witness_best_sign(rc), "purity": qm.purity(rho),
                    "coherence_A": float(2 * abs(qm.partial_trace(rho, [2, 2], [0])[0, 1])),
                    "coherence_B": float(2 * abs(qm.partial_trace(rho, [2, 2], [1])[0, 1])),
                    "correlators": {s: qm.correlator_from_probs(qm.outcome_probabilities(rc, s))
                                    for s in TOMOGRAPHY_SETTINGS}})
    return out
