r"""Single source of every displayed equation, in LaTeX (rendered by the web app with KaTeX).

Keys:
* MODEL_TEX[hypothesis_id] = {"dynamics": [...], "known_limits": [...]}
* SUITE_TEX[suite_number]   = [{"label", "tex", "note"}, ...]   governing equations shown on each suite page
* PROTOCOL_TEX              = dossier "Equations" section
Every string is display-mode LaTeX using only KaTeX-supported macros (checked in tests/test_equations.py).
"""
from __future__ import annotations

BMV_PHASE = r"\varphi_{ij} = -\frac{1}{\hbar}\int_0^{t} U_{ij}(t')\,\mathrm{d}t'"
DELTA_PHI = r"\Delta\varphi = \varphi_{LL} + \varphi_{RR} - \varphi_{LR} - \varphi_{RL}"
DEPHASED_STATE = (r"\rho_{ij,kl}(t) = \tfrac14\, e^{\,i(\varphi_{ij}-\varphi_{kl})}\,"
                  r"e^{-\Gamma_A t\,[i\neq k]}\, e^{-\Gamma_B t\,[j\neq l]}")
NEWTON_BRANCH = r"U_{ij} = -\frac{G\,m_A m_B}{r_{ij}}"
PARALLEL_LIMIT = (r"\Delta\varphi \xrightarrow{\text{point masses}} \frac{2 G m_A m_B t}{\hbar}"
                  r"\left(\frac{1}{d} - \frac{1}{\sqrt{d^2+\Delta x^2}}\right)")
THRESHOLD = (r"\rho(t)\ \text{separable}\ \forall\, t\ge 0 \iff \Gamma \ge \frac{|\omega|}{2},"
             r"\qquad \Delta\varphi(t) = \omega t")

MODEL_TEX: dict[str, dict[str, list[str]]] = {
    "QG-COH": {
        "dynamics": [r"\hat H = \sum_{i,j\in\{L,R\}} U_{ij}\,|ij\rangle\langle ij|", NEWTON_BRANCH, BMV_PHASE],
        "known_limits": [PARALLEL_LIMIT,
                         r"\langle \hat F \rangle = -\nabla \langle U \rangle\ \ \text{(Newtonian force on branch averages)}"],
    },
    "QG-EFT1": {
        "dynamics": [r"V(r) = -\frac{G m_1 m_2}{r}\left[1 + \frac{3G(m_1+m_2)}{r c^2}"
                     r" + \frac{41}{10\pi}\frac{G\hbar}{r^2 c^3}\right]"],
        "known_limits": [r"\frac{41}{10\pi}\frac{\ell_P^2}{r^2} \to 0 \ \Rightarrow\ \text{QG-COH}"],
    },
    "SC-MF": {
        "dynamics": [r"G_{\mu\nu} = \frac{8\pi G}{c^4}\,\langle \hat T_{\mu\nu} \rangle",
                     r"\varphi^{A}_{i} = -\frac{t}{\hbar}\sum_{j} p^{B}_{j}\,U_{ij},\qquad p^{B}_{L}=p^{B}_{R}=\tfrac12"],
        "known_limits": [r"\Delta\varphi_{\text{grav}} \equiv 0\quad\text{(no gravitational entanglement)}"],
    },
    "CC-KTM": {
        "dynamics": [r"\frac{\mathrm{d}\rho}{\mathrm{d}t} = -\frac{i}{\hbar}\big[\hat H_g,\rho\big]"
                     r" + \sum_{X\in\{A,B\}} \frac{\Gamma_{cc}}{2}\big(\hat Z_X\,\rho\,\hat Z_X - \rho\big)",
                     r"\Gamma_{cc} = \kappa\,\frac{|\Delta\varphi_g|}{2t},\qquad \kappa \ge 1"],
        "known_limits": [THRESHOLD, r"\kappa = 1:\ \text{minimal decoherence compatible with no gravitational entanglement}"],
    },
    "DP-COLL": {
        "dynamics": [r"\Gamma_{DP} = \frac{\kappa_{DP}}{\hbar}\big[U(\Delta x) - U(0)\big]"],
        "known_limits": [r"\Gamma_{DP} = \frac{\kappa_{DP}\, G m^2}{\hbar}\left(\frac{6}{5R} - \frac{1}{\Delta x}\right),"
                         r"\quad \Delta x \ge 2R", r"\Gamma_{DP} \to 0 \ \text{as}\ \Delta x \to 0"],
    },
    "CSL-COLL": {
        "dynamics": [r"\Gamma_{CSL} = \lambda\,\frac{(4\pi r_C^2)^{3/2}}{m_0^2}\int\!\frac{\mathrm{d}^3k}{(2\pi)^3}\,"
                     r"e^{-k^2 r_C^2}\,|\tilde\rho(\mathbf k)|^2\,\big(1-\cos\mathbf k\!\cdot\!\Delta\mathbf x\big)",
                     r"\tilde\rho(k) = m\,\frac{3\,(\sin kR - kR\cos kR)}{(kR)^3}"],
        "known_limits": [r"R \ll r_C:\quad \Gamma = \lambda\left(\frac{m}{m_0}\right)^{2}"
                         r"\left(1 - e^{-\Delta x^2/4 r_C^2}\right)", r"\lambda \to 0 \ \Rightarrow\ \text{QG-COH}"],
    },
    "NULL-NG": {
        "dynamics": [r"\hat H = \sum_{ij} U^{\mathrm{EM}}_{ij}\,|ij\rangle\langle ij|",
                     r"U_{CP}(r) = -\frac{23\,\hbar c}{4\pi}\,\frac{R_A^3 R_B^3}{r^7}"
                     r"\left(\frac{\varepsilon-1}{\varepsilon+2}\right)^{2}"],
        "known_limits": [r"\text{any entanglement is of electromagnetic origin}"],
    },
    "CG-QFT-AH": {
        "dynamics": [r"\beta^{(4)}_{ij} \approx \left(\frac{6}{25}\,\frac{i\,G^2 m^2 M^3 R\, t}{\hbar^3 d_{ij}}\right)^{2}",
                     r"\sqrt{\vartheta} = \frac{6}{25}\,\frac{G^2 m^2 M^3 R\,t}{\hbar^3 d_{RL}}"],
        "known_limits": [r"\frac{\vartheta}{\varphi} = \frac{36}{625}\,\frac{G^3 m^4 M^4 R^2 t}{\hbar^5 d}",
                         r"m \to 0 \ \Rightarrow\ \text{SC-MF}"],
    },
}

SUITE_TEX: dict[int, list[dict]] = {
    1: [{"label": "Lindblad master equation",
         "tex": r"\dot\rho = -i[\hat H,\rho] + \sum_k \Big(\hat L_k\rho\hat L_k^\dagger - \tfrac12\{\hat L_k^\dagger\hat L_k,\rho\}\Big)",
         "note": "H in rad/s (H/ħ)"},
        {"label": "Negativity", "tex": r"\mathcal N(\rho) = \tfrac12\big(\lVert\rho^{T_B}\rVert_1 - 1\big)"},
        {"label": "Concurrence", "tex": r"C = \max\{0,\ \lambda_1-\lambda_2-\lambda_3-\lambda_4\}"}],
    2: [{"label": "Schwarzschild orbit (Binet form)",
         "tex": r"\frac{\mathrm{d}^2u}{\mathrm{d}\phi^2} + u = \frac{GM}{h^2} + \frac{3GM}{c^2}u^2,\qquad u=\frac1r"},
        {"label": "Perihelion advance", "tex": r"\Delta\phi = \frac{6\pi G M}{c^2 a (1-e^2)}"},
        {"label": "Light deflection", "tex": r"\delta = \frac{4GM}{c^2 b}"}],
    3: [{"label": "One-loop EFT potential", "tex": MODEL_TEX["QG-EFT1"]["dynamics"][0]}],
    4: [{"label": "Branch energy", "tex": NEWTON_BRANCH}, {"label": "Branch phase", "tex": BMV_PHASE},
        {"label": "Entangling phase", "tex": DELTA_PHI}, {"label": "Dephased joint state", "tex": DEPHASED_STATE},
        {"label": "CPK witness", "tex": r"W_\pm = \mathbb 1 - X\!\otimes\! X \mp \big(Y\!\otimes\! Z + Z\!\otimes\! Y\big)"},
        {"label": "Exact separability threshold (Lean 4)", "tex": THRESHOLD}],
    5: [{"label": "Atom-interferometer phase", "tex": r"\Delta\phi = -k_{\mathrm{eff}}\, g\, T^2"},
        {"label": "Stern–Gerlach gradient", "tex": r"|\partial_x B| = \frac{2 m a}{g_e \mu_B},\qquad \Delta x = 2 a \tau^2"},
        {"label": "Recombination visibility",
         "tex": r"V = \exp\!\Big[-\tfrac{2\bar n+1}{2}\Big(\frac{\delta x^2}{4\sigma_0^2} + \frac{\delta p^2}{4\sigma_{p0}^2}\Big)\Big]"}],
    6: [{"label": "Gravitational coupling", "tex": r"\hat H_{\mathrm{int}} = \frac{2 G m_A m_B}{d^3}\,\hat x_A \hat x_B"},
        {"label": "Covariance dynamics", "tex": r"\dot V = A V + V A^{\mathsf T} + D"},
        {"label": "Log-negativity", "tex": r"E_{\mathcal N} = \max\{0,\ -\ln 2\tilde\nu_-\}"}],
    7: [{"label": "Gas collisions", "tex": r"\Gamma_{\mathrm{gas}} = n\,\pi R^2\,\bar v,\qquad n = \frac{P}{k_B T}"},
        {"label": "Black-body scattering",
         "tex": r"\Lambda_{\mathrm{sc}} = \frac{8!\,8\zeta(9)\,c R^6}{9\pi}\Big(\frac{k_BT}{\hbar c}\Big)^{9}\,"
                r"\mathrm{Re}\Big[\frac{\varepsilon-1}{\varepsilon+2}\Big]^{2}"},
        {"label": "Diósi–Penrose", "tex": MODEL_TEX["DP-COLL"]["dynamics"][0]},
        {"label": "CSL", "tex": MODEL_TEX["CSL-COLL"]["dynamics"][0]}],
    8: [{"label": "Casimir–Polder", "tex": MODEL_TEX["NULL-NG"]["dynamics"][1]},
        {"label": "Dipole–dipole", "tex": r"U = \frac{\mathbf p_A\!\cdot\!\mathbf p_B - 3(\mathbf p_A\!\cdot\!\hat n)(\mathbf p_B\!\cdot\!\hat n)}{4\pi\varepsilon_0 r^3}"},
        {"label": "Patch-induced dipole", "tex": r"p_{\mathrm{rms}} = 4\pi\varepsilon_0\, R\,\ell\,V_{\mathrm{rms}}\sqrt{\tfrac{3}{4\pi}}"}],
    10: [{"label": "Witness estimator", "tex": r"\hat W = 1 - \hat E_{XX} \mp \big(\hat E_{YZ} + \hat E_{ZY}\big),\qquad \sigma_{\hat E}^2 = \frac{1-E^2}{N}"}],
    11: [{"label": "Bayes factor", "tex": r"B_{10} = \frac{\int L(\theta)\,\pi_1(\theta)\,\mathrm d\theta}{\int L(\theta)\,\pi_0(\theta)\,\mathrm d\theta}"},
         {"label": "Fisher information", "tex": r"I_{ab} = N\sum_{s,k}\frac{\partial_a p_{sk}\,\partial_b p_{sk}}{p_{sk}}"}],
    12: [{"label": "Robust discrimination",
          "tex": r"D = \min_{\eta\in\mathcal H_{\mathrm{alt}}}\ \frac1S\sum_s \mathrm{KL}\big(p_s(\cdot\,|\,H_{\mathrm{true}})\,\Vert\,p_s(\cdot\,|\,H_{\mathrm{alt}},\eta)\big)"},
         {"label": "Shots for evidence", "tex": r"N = \frac{\ln B}{S\,D}"}],
    13: [{"label": "Design objective", "tex": r"\min_{m,d,\Delta x,t}\ \log_{10}\!\big[3\,N_{5\sigma}\,(t + t_{\mathrm{oh}})\big]"}],
    14: [{"label": "Discovered far-field law", "tex": r"\Delta\varphi \propto \frac{G\, m^2\, \Delta x^2\, t}{\hbar\, d^3}"},
         {"label": "Calibration trade-off (candidate)", "tex": r"s^\ast = 1 + \frac{|\Delta\varphi_g|}{2\,\Gamma_{\mathrm{env}}\, t}"}],
}

PROTOCOL_TEX = {
    "branch_energy": NEWTON_BRANCH,
    "branch_phase": BMV_PHASE,
    "entangling_phase": DELTA_PHI,
    "state": DEPHASED_STATE,
    "classical_channel_threshold": THRESHOLD,
}


def model_tex(hid: str) -> dict:
    return MODEL_TEX.get(hid, {"dynamics": [], "known_limits": []})
