"""Suite 10 — Precision measurement and signal processing.

* Synthetic two-qubit measurement records (always labelled SYNTHETIC, with seed and model provenance).
* Entanglement-witness and tomography estimators with analytic and bootstrap uncertainties.
* Time-series tools: Welch spectral density, matched-filter detection, signal injection–recovery and
  false-positive calibration with noise-only null trials (spec Part II §E experimental checks).
* Interferometric phase/visibility estimation from fringe scans (linear least squares).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

import numpy as np
from scipy import signal as sps
from scipy import stats

from . import quantum as qm
from . import bmv


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


@dataclass
class DetectorModel:
    readout_error_A: float = 0.01
    readout_error_B: float = 0.01
    efficiency_A: float = 1.0     # probability a run yields a valid readout of A
    efficiency_B: float = 1.0


def simulate_counts(rho: np.ndarray, settings: list[str], shots_per_setting: int, detector: DetectorModel,
                    seed: int, model_id: str, config: dict | None = None) -> dict:
    """Sample multinomial outcome counts for each Pauli setting. Lost runs (inefficiency) are discarded,
    i.e. the analysis is post-selected on both detections — the detection-loophole assumption is recorded."""
    rng = np.random.default_rng(seed)
    V = qm.setting_vectors(settings)
    P = qm.outcome_probabilities_all(rho, V)
    counts = {}
    eta = detector.efficiency_A * detector.efficiency_B
    for s, p in zip(settings, P):
        p = qm.apply_readout_error(p, detector.readout_error_A, detector.readout_error_B)
        n_valid = rng.binomial(shots_per_setting, eta)
        counts[s] = rng.multinomial(n_valid, p / p.sum()).tolist()
    record = {
        "data_label": "SYNTHETIC",
        "generator": {"model_id": model_id, "seed": seed, "shots_per_setting": shots_per_setting,
                      "detector": detector.__dict__, "config": config or {}},
        "assumptions": ["fair sampling of detected runs (post-selection on both detections)",
                        "independent symmetric readout errors", "identical state preparation every run"],
        "counts": counts, "outcome_order": ["++", "+-", "-+", "--"],
    }
    record["sha256"] = _hash({k: record[k] for k in ("generator", "counts")})
    return record


def correlators_with_errors(counts: dict) -> dict:
    """Correlator <s_a s_b> = (n++ - n+- - n-+ + n--)/n with multinomial standard error sqrt((1-E²)/n)."""
    out = {}
    for s, n in counts.items():
        n = np.asarray(n, float)
        N = n.sum()
        E = (n[0] - n[1] - n[2] + n[3]) / N
        out[s] = {"value": float(E), "stderr": float(np.sqrt(max(1 - E**2, 0) / N)), "n": int(N)}
    return out


def readout_corrected(E: float, eps_a: float, eps_b: float) -> float:
    """Unbias a correlator for symmetric readout flips: E_true = E_meas / ((1-2ε_a)(1-2ε_b))."""
    return E / ((1 - 2 * eps_a) * (1 - 2 * eps_b))


def witness_estimate(counts: dict, sign: int = +1, eps_a: float = 0.0, eps_b: float = 0.0,
                     n_boot: int = 2000, seed: int = 1) -> dict:
    """<W> = 1 - <XX> - sign(<YZ> + <ZY>) with analytic and bootstrap uncertainty.

    One-sided significance: z = -<W>/σ; entanglement claimed only if the prespecified threshold is met.
    """
    c = correlators_with_errors({k: counts[k] for k in ("XX", "YZ", "ZY")})
    f = 1 / ((1 - 2 * eps_a) * (1 - 2 * eps_b))
    W = 1 - f * c["XX"]["value"] - sign * f * (c["YZ"]["value"] + c["ZY"]["value"])
    sig = f * np.sqrt(c["XX"]["stderr"] ** 2 + c["YZ"]["stderr"] ** 2 + c["ZY"]["stderr"] ** 2)
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(n_boot):
        e = {}
        for s in ("XX", "YZ", "ZY"):
            n = np.asarray(counts[s], float)
            nb = rng.multinomial(int(n.sum()), n / n.sum())
            e[s] = (nb[0] - nb[1] - nb[2] + nb[3]) / nb.sum()
        boots.append(1 - f * e["XX"] - sign * f * (e["YZ"] + e["ZY"]))
    boots = np.array(boots)
    z = -W / sig if sig > 0 else 0.0
    return {"witness": float(W), "stderr": float(sig), "bootstrap_ci95": [float(np.percentile(boots, 2.5)),
            float(np.percentile(boots, 97.5))], "z_score": float(z), "p_value_one_sided": float(stats.norm.sf(z)),
            "sign_variant": sign, "readout_correction_factor": f}


def tomography_with_uncertainty(counts: dict, n_boot: int = 200, seed: int = 2) -> dict:
    """MLE state reconstruction, negativity and concurrence with parametric-bootstrap 95% intervals."""
    rho = qm.mle_tomography(counts)
    rng = np.random.default_rng(seed)
    negs, cons = [], []
    for _ in range(n_boot):
        cb = {}
        for s, n in counts.items():
            n = np.asarray(n, float)
            cb[s] = rng.multinomial(int(n.sum()), n / n.sum())
        r = qm.mle_tomography(cb, iters=400)
        negs.append(qm.negativity(r)); cons.append(qm.concurrence(r))
    return {"rho_real": rho.real.tolist(), "rho_imag": rho.imag.tolist(),
            "negativity": qm.negativity(rho), "negativity_ci95": [float(np.percentile(negs, 2.5)), float(np.percentile(negs, 97.5))],
            "concurrence": qm.concurrence(rho), "concurrence_ci95": [float(np.percentile(cons, 2.5)), float(np.percentile(cons, 97.5))],
            "purity": qm.purity(rho), "state_check": qm.check_density_matrix(rho, 1e-8).as_dict(),
            "method": "iterative maximum likelihood (RρR) with parametric bootstrap"}


# ----------------------------------------------------------------------------- time series
def welch_psd(x: np.ndarray, fs: float, nperseg: int | None = None) -> dict:
    f, P = sps.welch(x, fs=fs, nperseg=nperseg or min(len(x), 1024))
    return {"frequency_Hz": f.tolist(), "psd_per_Hz": P.tolist()}


def matched_filter_snr(data: np.ndarray, template: np.ndarray, noise_sigma: float) -> np.ndarray:
    """SNR time series for a known template in white noise of standard deviation noise_sigma."""
    tpl = template / np.sqrt(np.sum(template**2))
    return np.correlate(data, tpl, mode="valid") / noise_sigma


def injection_recovery(template: np.ndarray, amplitudes: np.ndarray, n_samples: int, noise_sigma: float,
                       threshold: float, trials: int = 200, seed: int = 0) -> dict:
    """Detection efficiency vs injected amplitude, and the noise-only false-positive rate at the threshold."""
    rng = np.random.default_rng(seed)
    L = len(template)
    eff = []
    for A in amplitudes:
        det = 0
        for _ in range(trials):
            x = rng.normal(0, noise_sigma, n_samples)
            k = rng.integers(0, n_samples - L)
            x[k:k + L] += A * template
            det += np.max(matched_filter_snr(x, template, noise_sigma)) > threshold
        eff.append(det / trials)
    fp = 0
    for _ in range(trials):
        x = rng.normal(0, noise_sigma, n_samples)
        fp += np.max(matched_filter_snr(x, template, noise_sigma)) > threshold
    return {"amplitudes": list(map(float, amplitudes)), "detection_efficiency": eff,
            "false_positive_rate": fp / trials, "trials": trials, "threshold_snr": threshold,
            "data_label": "SYNTHETIC"}


def fringe_fit(phases_set: np.ndarray, counts_plus: np.ndarray, counts_total: np.ndarray) -> dict:
    """Fit P(+|θ) = ½(1 + V cos(θ - φ)) by weighted linear least squares in (cos θ, sin θ)."""
    p = counts_plus / counts_total
    w = counts_total / np.clip(p * (1 - p), 1e-6, None)
    A = np.column_stack([np.ones_like(phases_set), np.cos(phases_set), np.sin(phases_set)])
    W = np.diag(w)
    coef, *_ = np.linalg.lstsq(np.sqrt(W) @ A, np.sqrt(W) @ p, rcond=None)
    cov = np.linalg.inv(A.T @ W @ A)
    a, b = coef[1], coef[2]
    V = 2 * np.hypot(a, b)
    phi = np.arctan2(b, a)
    J = np.array([[0, 2 * a / np.hypot(a, b), 2 * b / np.hypot(a, b)],
                  [0, -b / (a**2 + b**2), a / (a**2 + b**2)]])
    cv = J @ cov @ J.T
    return {"visibility": float(V), "visibility_err": float(np.sqrt(cv[0, 0])),
            "phase_rad": float(phi), "phase_err_rad": float(np.sqrt(cv[1, 1]))}
