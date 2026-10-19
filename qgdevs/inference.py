"""Suite 11 — Inverse physics and statistical inference.

The inverse problem: from measured two-qubit outcome counts, reconstruct the physical parameters of a
generic gravitational-coupling family
    Δφ = λ · Δφ_Newton(design),   single-mass decay exponents (Γ t),   local phases (β, γ),
where λ = 1 is the quantum-coherent Newtonian prediction and λ = 0 means no gravitational branch
coupling. Posterior inference uses an adaptive Metropolis sampler (Haario, Saksman & Tamminen 2001);
model comparison uses nuisance-marginalised evidence by prior Monte-Carlo integration and a
likelihood-ratio test calibrated by parametric bootstrap (Wilks' theorem is not assumed at bounds).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.special import logsumexp, gammaln

from . import bmv, quantum as qm


@dataclass
class ParamSpec:
    name: str
    low: float
    high: float
    unit: str = "1"


@dataclass
class CouplingModel:
    """Forward model mapping parameters to outcome probabilities for a fixed design and protocol frame."""
    design: bmv.BMVDesign
    settings: list[str]
    readout_error: float = 0.01
    params: list[ParamSpec] = field(default_factory=lambda: [
        ParamSpec("lambda", -0.5, 2.0), ParamSpec("decay", 0.0, 2.0),
        ParamSpec("beta_err", -0.3, 0.3, "rad"), ParamSpec("gamma_err", -0.3, 0.3, "rad")])

    def __post_init__(self):
        E = bmv.gravitational_branch_energies(self.design)
        self._ph0 = bmv.phases_from_energies(E, self.design.time)
        self._dphi_newton = bmv.entangling_phase(self._ph0)
        self._frame = bmv.local_phase_correction(self._ph0)
        self._V = qm.setting_vectors(self.settings)
        M = np.array([[1 - self.readout_error, self.readout_error], [self.readout_error, 1 - self.readout_error]])
        self._M = np.kron(M, M)

    @property
    def names(self):
        return [p.name for p in self.params]

    def probabilities(self, theta: np.ndarray) -> np.ndarray:
        lam, decay, b_err, g_err = theta
        dec = bmv.decompose_phases(self._ph0)
        ph = {k: dec["alpha"] + (dec["beta"] + b_err) * bmv.Z_SIGN[k[0]] + (dec["gamma"] + g_err) * bmv.Z_SIGN[k[1]]
              + lam * dec["delta_phi"] / 4 * bmv.Z_SIGN[k[0]] * bmv.Z_SIGN[k[1]] for k in bmv.BRANCH_LABELS}
        rho = bmv.joint_state(ph, decay, decay)
        rho = self._frame @ rho @ self._frame.conj().T
        return qm.outcome_probabilities_all(rho, self._V) @ self._M.T

    def in_prior(self, theta) -> bool:
        return all(p.low <= t <= p.high for p, t in zip(self.params, theta))


def log_likelihood(model: CouplingModel, theta, counts: dict) -> float:
    P = model.probabilities(np.asarray(theta))
    ll = 0.0
    for k, s in enumerate(model.settings):
        n = np.asarray(counts[s], float)
        ll += gammaln(n.sum() + 1) - np.sum(gammaln(n + 1)) + np.sum(n * np.log(np.clip(P[k], 1e-300, None)))
    return float(ll)


def adaptive_metropolis(model: CouplingModel, counts: dict, n_steps: int = 6000, burn: int = 2000,
                        seed: int = 0, theta0=None) -> dict:
    rng = np.random.default_rng(seed)
    d = len(model.params)
    th = np.array(theta0 if theta0 is not None else [(p.low + p.high) / 2 for p in model.params], float)
    lp = log_likelihood(model, th, counts)
    cov = np.diag([((p.high - p.low) / 20) ** 2 for p in model.params])
    chain, acc = [], 0
    sd = 2.38**2 / d
    for i in range(n_steps):
        prop = rng.multivariate_normal(th, cov)
        if model.in_prior(prop):
            lpp = log_likelihood(model, prop, counts)
            if np.log(rng.random()) < lpp - lp:
                th, lp = prop, lpp
                acc += 1
        chain.append(th.copy())
        if i >= 500 and i % 100 == 0:
            cov = sd * np.cov(np.array(chain[i // 2:]).T) + 1e-10 * np.eye(d)
    burn = min(burn, n_steps // 3)  # never discard the whole chain
    ch = np.array(chain[burn:])
    summ = {}
    for k, p in enumerate(model.params):
        x = ch[:, k]
        summ[p.name] = {"mean": float(x.mean()), "std": float(x.std()), "median": float(np.median(x)),
                        "ci95": [float(np.percentile(x, 2.5)), float(np.percentile(x, 97.5))], "unit": p.unit}
    return {"summary": summ, "acceptance_rate": acc / n_steps, "n_samples": len(ch),
            "samples": ch[:: max(1, len(ch) // 1000)].tolist(), "names": model.names,
            "effective_sample_size": {p.name: _ess(ch[:, k]) for k, p in enumerate(model.params)}}


def _ess(x: np.ndarray) -> float:
    x = x - x.mean()
    n = len(x)
    if n < 10 or np.allclose(x, 0):
        return float(n)
    f = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(f * np.conj(f))[:n]
    ac /= ac[0]
    s = 0.0
    for k in range(1, n):
        if ac[k] < 0.05:
            break
        s += ac[k]
    return float(n / (1 + 2 * s))


def log_evidence(model: CouplingModel, counts: dict, fixed: dict | None = None, n: int = 4000, seed: int = 0) -> dict:
    """ln Z = ln E_prior[L(θ)] by uniform-prior Monte Carlo; parameters in `fixed` are held at given values."""
    rng = np.random.default_rng(seed)
    fixed = fixed or {}
    lls = []
    for _ in range(n):
        th = [fixed.get(p.name, rng.uniform(p.low, p.high)) for p in model.params]
        lls.append(log_likelihood(model, th, counts))
    lls = np.array(lls)
    lz = logsumexp(lls) - np.log(n)
    w = np.exp(lls - lls.max())
    ess = w.sum() ** 2 / (w**2).sum()
    return {"ln_Z": float(lz), "importance_ess": float(ess),
            "mc_stderr_ln_Z": float(np.std(np.exp(lls - lz)) / np.sqrt(n))}


def laplace_log_evidence(model: CouplingModel, counts: dict, fixed: dict | None = None, seed: int = 0,
                         h: float = 1e-4) -> dict:
    """ln Z ≈ ln L(θ̂) + (k/2) ln 2π - ½ ln det H - ln V_prior  (uniform priors; Laplace approximation).

    Accurate when the posterior is well inside the prior and close to Gaussian; the result reports
    whether the mode lies on a prior boundary, in which case the approximation is flagged unreliable.
    """
    fixed = fixed or {}
    mx = maximise(model, counts, fixed=fixed, seed=seed)
    theta = np.array(mx["theta"], float)
    free = [i for i, p in enumerate(model.params) if p.name not in fixed]
    k = len(free)
    H = np.zeros((k, k))
    f0 = log_likelihood(model, theta, counts)
    steps = [h * (model.params[i].high - model.params[i].low) for i in free]

    def ll(dx):
        th = theta.copy()
        for (i, d) in zip(free, dx):
            th[i] += d
        return log_likelihood(model, th, counts)

    for a in range(k):
        for b in range(a, k):
            ea = np.zeros(k); ea[a] = steps[a]
            eb = np.zeros(k); eb[b] = steps[b]
            if a == b:
                H[a, a] = -(ll(ea) - 2 * f0 + ll(-ea)) / steps[a] ** 2
            else:
                H[a, b] = H[b, a] = -(ll(ea + eb) - ll(ea - eb) - ll(-ea + eb) + ll(-ea - eb)) / (4 * steps[a] * steps[b])
    sign, logdet = np.linalg.slogdet(H)
    vol = np.sum([np.log(model.params[i].high - model.params[i].low) for i in free])
    on_boundary = [model.params[i].name for i in free
                   if min(theta[i] - model.params[i].low, model.params[i].high - theta[i]) < 3 * np.sqrt(abs(np.linalg.pinv(H)[free.index(i), free.index(i)]))]
    return {"ln_Z": float(f0 + 0.5 * k * np.log(2 * np.pi) - 0.5 * logdet - vol), "mode": theta.tolist(),
            "hessian_positive_definite": bool(sign > 0 and np.all(np.linalg.eigvalsh(H) > 0)),
            "mode_near_prior_boundary": on_boundary}


def savage_dickey(post_samples: np.ndarray, model: CouplingModel, name: str, value: float) -> dict:
    """B_01 = p(θ=value | data) / p(θ=value) for nested models with separable priors (Dickey 1971).

    Posterior density estimated by Gaussian KDE; if `value` lies far in the tail the estimate is only
    a bound and is flagged as such."""
    from scipy.stats import gaussian_kde
    k = model.names.index(name)
    x = np.asarray(post_samples)[:, k]
    p = model.params[k]
    dens = float(gaussian_kde(x)(value)[0])
    prior = 1 / (p.high - p.low)
    tail = bool(abs(value - x.mean()) > 4 * x.std())
    return {"ln_B01": float(np.log(max(dens, 1e-300) / prior)), "tail_extrapolation": tail}


def bayes_factor_coupling(model: CouplingModel, counts: dict, lam_alt: float = 0.0, seed: int = 0) -> dict:
    """ln B = ln Z(λ free) - ln Z(λ = lam_alt), all nuisance marginalised (Laplace)."""
    z1 = laplace_log_evidence(model, counts, seed=seed)
    z0 = laplace_log_evidence(model, counts, fixed={"lambda": lam_alt}, seed=seed)
    lnB = z1["ln_Z"] - z0["ln_Z"]
    return {"ln_B": lnB, "free": z1, "null": z0, "null_lambda": lam_alt, "method": "Laplace approximation",
            "interpretation": _kass_raftery(lnB)}


def _kass_raftery(lnB: float) -> str:
    B2 = 2 * lnB
    if B2 < 0:
        return "favours the null"
    if B2 < 2:
        return "not worth more than a bare mention"
    if B2 < 6:
        return "positive"
    if B2 < 10:
        return "strong"
    return "very strong"


def maximise(model: CouplingModel, counts: dict, fixed: dict | None = None, seed: int = 0) -> dict:
    from scipy.optimize import minimize
    fixed = fixed or {}
    free = [p for p in model.params if p.name not in fixed]

    def full(x):
        it = iter(x)
        return [fixed[p.name] if p.name in fixed else next(it) for p in model.params]

    rng = np.random.default_rng(seed)
    best = None
    for _ in range(6):
        x0 = [rng.uniform(p.low, p.high) for p in free]
        r = minimize(lambda x: -log_likelihood(model, full(x), counts) if model.in_prior(full(x)) else 1e300,
                     x0, method="Nelder-Mead", options={"xatol": 1e-7, "fatol": 1e-9, "maxiter": 4000})
        if best is None or r.fun < best.fun:
            best = r
    return {"theta": full(best.x), "max_log_likelihood": float(-best.fun)}


def likelihood_ratio_test(model: CouplingModel, counts: dict, lam_null: float = 0.0, n_boot: int = 100,
                          seed: int = 0) -> dict:
    """LRT of λ = lam_null with a parametric-bootstrap null distribution."""
    from .sigproc import simulate_counts, DetectorModel
    full = maximise(model, counts, seed=seed)
    null = maximise(model, counts, fixed={"lambda": lam_null}, seed=seed)
    stat = 2 * (full["max_log_likelihood"] - null["max_log_likelihood"])
    rng = np.random.default_rng(seed)
    shots = int(np.sum(counts[model.settings[0]]))
    boot = []
    P0 = model.probabilities(np.array(null["theta"]))
    for b in range(n_boot):
        cb = {s: rng.multinomial(shots, P0[k] / P0[k].sum()).tolist() for k, s in enumerate(model.settings)}
        f = maximise(model, cb, seed=b)
        n0 = maximise(model, cb, fixed={"lambda": lam_null}, seed=b)
        boot.append(2 * (f["max_log_likelihood"] - n0["max_log_likelihood"]))
    boot = np.array(boot)
    p = (1 + np.sum(boot >= stat)) / (1 + n_boot)
    return {"statistic": float(stat), "p_value_bootstrap": float(p), "n_boot": n_boot,
            "mle_full": full["theta"], "mle_null": null["theta"], "names": model.names}


def fisher_information(model: CouplingModel, theta, shots_per_setting: int, h: float = 1e-5) -> dict:
    """Expected Fisher information I = N Σ_s Σ_k (∂p_sk)(∂p_sk)ᵀ / p_sk and identifiability diagnostics."""
    theta = np.asarray(theta, float)
    P = model.probabilities(theta)
    grads = []
    for i in range(len(theta)):
        e = np.zeros_like(theta); e[i] = h
        grads.append((model.probabilities(theta + e) - model.probabilities(theta - e)) / (2 * h))
    G = np.array(grads)  # (n_par, S, 4)
    I = shots_per_setting * np.einsum("isk,jsk,sk->ij", G, G, 1 / np.clip(P, 1e-300, None))
    w = np.linalg.eigvalsh(I)
    crb = np.sqrt(np.diag(np.linalg.pinv(I)))
    return {"fisher": I.tolist(), "eigenvalues": w.tolist(),
            "condition_number": float(w.max() / max(w.min(), 1e-300)),
            "identifiable": bool(w.min() > 1e-9 * w.max()),
            "cramer_rao_std": dict(zip(model.names, crb.tolist()))}


def posterior_predictive_pvalue(model: CouplingModel, counts: dict, samples: np.ndarray, n: int = 200,
                                seed: int = 0) -> float:
    """Posterior predictive check with the chi-square discrepancy (Gelman, Meng & Stern 1996)."""
    rng = np.random.default_rng(seed)
    shots = {s: int(np.sum(counts[s])) for s in model.settings}
    obs = np.array([counts[s] for s in model.settings], float)
    exceed = 0
    idx = rng.integers(0, len(samples), n)
    for i in idx:
        P = model.probabilities(np.asarray(samples[i]))
        expct = np.array([P[k] * shots[s] for k, s in enumerate(model.settings)])
        rep = np.array([rng.multinomial(shots[s], P[k] / P[k].sum()) for k, s in enumerate(model.settings)])
        d_obs = np.sum((obs - expct) ** 2 / np.clip(expct, 1e-9, None))
        d_rep = np.sum((rep - expct) ** 2 / np.clip(expct, 1e-9, None))
        exceed += d_rep >= d_obs
    return float(exceed / n)
