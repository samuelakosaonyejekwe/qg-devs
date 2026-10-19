"""Interactive Scientific Thought Experiment Laboratory.

Workflow: prompt → interpretation → structured, reviewable configuration → validation → (user approval)
→ execution by the deterministic solvers → report with links to the experimental dossier.

Two interpreters produce the *same* configuration schema:
* `interpret_deterministic` — rule-based extraction of the physical system, quantities and units. Always
  available; the platform is fully usable without any language model.
* `interpret_with_language_model` — optional assistant (Language Model: ON/OFF). Providers: the Anthropic
  API (official SDK, structured JSON output) or a locally deployed model served by Ollama. The model only
  proposes a configuration; every value it introduces is labelled LM_PROPOSED for the researcher to review,
  and the configuration passes the same validation. It never computes results, never fabricates
  measurements and cannot trigger execution or hardware actions.

Investigation categories (directive §5): THEORETICAL thought experiment, COMPUTATIONAL experiment,
VIRTUAL LABORATORY experiment, PHYSICAL LABORATORY experiment. Completing the first three never
constitutes physical evidence.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from . import bmv, materials
from .units import to_si

FAMILIES = {
    "bmv": "Gravity-mediated entanglement of two spatially superposed masses",
    "optomech": "Gravitationally coupled mechanical oscillators (Gaussian states)",
    "atom_interferometer": "Light-pulse atom interferometry in a gravitational field",
    "orbit": "Classical orbit / light deflection in Schwarzschild spacetime",
    "collapse": "Gravitational collapse (Diósi–Penrose) decoherence of one superposed mass",
}

KEYWORDS = {
    "bmv": ["entangle", "superposition", "two mass", "two masses", "bose", "marletto", "vedral", "bmv", "spin", "witness"],
    "optomech": ["oscillator", "optomechan", "cavity", "resonator", "phonon", "trap frequency", "squeez"],
    "atom_interferometer": ["atom interferometer", "kasevich", "light-pulse", "atomic fountain", "gravimeter", "raman"],
    "orbit": ["orbit", "perihelion", "precession", "light bend", "deflection", "geodesic", "mercury", "schwarzschild"],
    "collapse": ["collapse", "penrose", "diósi", "diosi", "objective reduction"],
}

SPECULATIVE_MARKERS = ["wormhole", "time travel", "faster than light", "inside a black hole", "planck scale",
                       "string", "loop quantum", "multiverse", "before the big bang", "negative mass", "warp"]

NUM = r"([-+]?\d+(?:\.\d+)?(?:\s*(?:[eE]\s*[-+]?\d+|[x×]\s*10\s*\^?\s*[-+−]?\d+))?)"
UNIT = r"(kg|mg|ug|µg|ng|pg|fg|g|amu|nm|um|µm|μm|mm|cm|m|micrometres?|micrometers?|microns?|ms|us|µs|ns|s|seconds?|min|mK|uK|µK|K|Pa|mbar|bar|Torr|torr)\b"


def _num(s: str) -> float:
    s = s.replace(" ", "").replace("−", "-")
    m = re.match(r"([-+]?\d+(?:\.\d+)?)[x×]10\^?([-+]?\d+)", s)
    if m:
        return float(m.group(1)) * 10 ** int(m.group(2))
    return float(s)


@dataclass
class Quantity:
    role: str
    value: float
    unit: str
    si_value: float
    source: str            # USER_STATED | DEFAULT_ASSUMPTION | LM_PROPOSED | DERIVED
    text: str = ""


@dataclass
class ThoughtConfig:
    prompt: str
    family: str | None
    category: str
    quantities: dict[str, Quantity] = field(default_factory=dict)
    material: str = "diamond"
    geometry: str = "parallel"
    assumptions: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    clarifications: list[str] = field(default_factory=list)
    speculative: bool = False
    domain_notes: list[str] = field(default_factory=list)
    interpreter: str = "deterministic"
    approved: bool = False

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["quantities"] = {k: v.__dict__ for k, v in self.quantities.items()}
        d["family_description"] = FAMILIES.get(self.family or "", "unsupported")
        return d


REQUIRED = {
    "bmv": ["mass", "separation", "branch_separation", "time"],
    "collapse": ["mass", "branch_separation"],
    "optomech": ["mass", "separation", "frequency"],
    "atom_interferometer": ["time"],
    "orbit": [],
}
DEFAULTS = {  # value (SI) and the reason it is a reasonable reference value
    "mass": (1e-14, "kg", "BMV reference mass (Bose et al. 2017)"),
    "separation": (450e-6, "m", "BMV reference centre separation (Bose et al. 2017)"),
    "branch_separation": (250e-6, "m", "BMV reference superposition size (Bose et al. 2017)"),
    "time": (2.5, "s", "BMV reference interaction time (Bose et al. 2017)"),
    "temperature": (0.15, "K", "cryogenic environment assumed"),
    "pressure": (1e-15, "Pa", "extreme-high-vacuum assumed"),
    "frequency": (6.283185307, "rad/s", "1 Hz trap assumed"),
}

ROLE_CUES = [
    ("branch_separation", ["superpos", "split", "branch", "delocali", "spatial separation of", "Δx", "dx"]),
    ("separation", ["apart", "separat", "distance", "between", "away", "spaced"]),
    ("time", ["for", "during", "duration", "interact", "evolve", "wait", "hold"]),
    ("temperature", ["temperature", "cooled", "kelvin", "at "]),
    ("pressure", ["pressure", "vacuum"]),
    ("mass", ["mass", "weigh", "particle", "sphere", "object"]),
]


def _assign_role(kind: str, prompt: str, start: int, end: int, taken: set[str]) -> str | None:
    """Map a length to 'separation' or 'branch_separation' by the nearest textual cue (either side)."""
    if kind in ("mass", "time", "temperature", "pressure"):
        return kind
    if kind != "separation":
        return None
    low = prompt.lower()
    best = None
    for role in ("branch_separation", "separation"):
        if role in taken:
            continue
        for cue in dict(ROLE_CUES)[role]:
            for m in re.finditer(re.escape(cue.lower()), low):
                dist = start - m.end() if m.end() <= start else m.start() - end
                if dist < 0 or dist > 45:
                    continue
                if best is None or dist < best[0]:
                    best = (dist, role)
    if best:
        return best[1]
    return next((r for r in ("separation", "branch_separation") if r not in taken), None)


def interpret_deterministic(prompt: str) -> ThoughtConfig:
    p = prompt.lower()
    scores = {f: sum(k in p for k in kws) for f, kws in KEYWORDS.items()}
    family = max(scores, key=scores.get) if max(scores.values()) > 0 else None
    category = ("PHYSICAL" if any(w in p for w in ["measured data", "my lab", "our apparatus", "real measurement"])
                else "VIRTUAL" if any(w in p for w in ["apparatus", "detector", "vacuum", "chamber", "noise"])
                else "COMPUTATIONAL" if family else "THEORETICAL")
    cfg = ThoughtConfig(prompt=prompt, family=family, category=category)
    taken: set[str] = set()
    for m in re.finditer(NUM + r"\s*" + UNIT, prompt):
        val, unit = _num(m.group(1)), m.group(2)
        unit_norm = {"micrometre": "um", "micrometres": "um", "micrometer": "um", "micrometers": "um",
                     "micron": "um", "microns": "um", "seconds": "s", "second": "s", "μm": "um"}.get(unit, unit)
        try:
            si, kind = to_si(val, unit_norm)
        except ValueError:
            continue
        role = _assign_role(kind, prompt, m.start(), m.end(), taken)
        if role and role not in taken:
            cfg.quantities[role] = Quantity(role, val, unit, si, "USER_STATED", m.group(0))
            taken.add(role)
    for key in materials.MATERIALS:
        if key in p:
            cfg.material = key
    if "linear" in p or "in line" in p or "collinear" in p:
        cfg.geometry = "linear"
    cfg.speculative = any(w in p for w in SPECULATIVE_MARKERS)
    if cfg.speculative and not cfg.quantities:
        cfg.family = None          # keyword overlap alone must not turn speculation into a computation
        cfg.category = "THEORETICAL"
    return finalise(cfg)


def finalise(cfg: ThoughtConfig) -> ThoughtConfig:
    """Shared validation for every interpreter: fill labelled defaults, list gaps, check the domain."""
    if cfg.family is None:
        cfg.clarifications.append("Which physical system should be modelled? Supported: " + "; ".join(FAMILIES.values()))
        cfg.domain_notes.append("No implemented model matches this prompt: it remains a THEORETICAL thought experiment "
                                "and no numerical result will be produced.")
        return cfg
    for role in REQUIRED.get(cfg.family, []):
        if role not in cfg.quantities:
            v, unit, why = DEFAULTS[role]
            cfg.quantities[role] = Quantity(role, v, unit, v, "DEFAULT_ASSUMPTION", why)
            cfg.missing.append(role)
            cfg.assumptions.append(f"{role} = {v:g} {unit} ({why}) — please confirm or change")
    if cfg.family in ("bmv", "collapse"):
        cfg.assumptions += ["masses are uniform spheres of the selected material",
                            "each superposition is an equal-weight two-branch state |L>+|R>",
                            "Newtonian (weak-field, non-relativistic) interaction between branches",
                            f"material: {cfg.material}"]
        for role in ("temperature", "pressure"):
            if role not in cfg.quantities:
                v, unit, why = DEFAULTS[role]
                cfg.quantities[role] = Quantity(role, v, unit, v, "DEFAULT_ASSUMPTION", why)
                cfg.assumptions.append(f"{role} = {v:g} {unit} ({why})")
    if cfg.family == "bmv":
        d = to_design(cfg)
        issues = bmv.check_geometry(d)
        if issues:
            cfg.domain_notes += [f"inadmissible configuration: {i}" for i in issues]
        if d.separation / 299792458.0 > 1e-6 * d.time:
            cfg.domain_notes.append("retardation not negligible: static Newtonian model outside its domain")
    if cfg.speculative:
        cfg.domain_notes.append("Prompt involves physics outside every implemented model's validated domain; "
                                "any answer is SPECULATIVE and no calculation is presented as established.")
    return cfg


def to_design(cfg: ThoughtConfig) -> bmv.BMVDesign:
    q = {k: v.si_value for k, v in cfg.quantities.items()}
    m = q.get("mass", 1e-14)
    dx = q.get("branch_separation", 250e-6)
    return bmv.BMVDesign(mass_A=m, mass_B=m, density=materials.get(cfg.material).density,
                         separation=q.get("separation", 450e-6), dx_A=dx, dx_B=dx,
                         geometry=cfg.geometry, time=q.get("time", 2.5))


def execute(cfg: ThoughtConfig) -> dict:
    """Run the deterministic solvers for an approved configuration."""
    if not cfg.approved:
        raise PermissionError("configuration must be reviewed and approved by the researcher before execution")
    if cfg.family is None:
        return {"status": "NOT_COMPUTED", "reason": "no implemented model matches; theoretical thought experiment only",
                "domain_notes": cfg.domain_notes}
    from .design import Environment, scenario_for
    from .discrimination import predictions_table
    q = {k: v.si_value for k, v in cfg.quantities.items()}
    out = {"category": cfg.category, "family": cfg.family, "config": cfg.as_dict(),
           "evidence_status": "COMPUTATIONAL PREDICTION — not physical evidence"}
    if cfg.family == "bmv":
        d = to_design(cfg)
        env = Environment(pressure=q.get("pressure", 1e-15), T_gas=q.get("temperature", 0.15),
                          T_env=q.get("temperature", 0.15), T_int=q.get("temperature", 0.15), material=cfg.material)
        sc, extra = scenario_for(d, env)
        out["prediction"] = bmv.predict(d)
        out["decoherence"] = extra["decoherence_A"]
        out["competing_models"] = predictions_table(sc)
        out["next_steps"] = ["open the design in the Virtual Laboratory (Suite 9) for the full dossier",
                             "run model discrimination (Suite 12) and design optimisation (Suite 13)",
                             "preregister before any physical measurement (Suite 18)"]
    elif cfg.family == "collapse":
        from .decoherence import diosi_penrose_rate
        R = (3 * q["mass"] / (4 * 3.141592653589793 * materials.get(cfg.material).density)) ** (1 / 3)
        out["diosi_penrose"] = {**diosi_penrose_rate(q["mass"], R, q["branch_separation"]),
                                "radius_m": R}
    elif cfg.family == "optomech":
        from .optomech import evolve_coupled_oscillators
        out["oscillators"] = evolve_coupled_oscillators(q["mass"], q["mass"], q["separation"], q["frequency"],
                                                        q.get("temperature", 0.0), 1e-3, 0.0, 100.0, 100)
    elif cfg.family == "atom_interferometer":
        from .interferometry import kasevich_chu_phase
        k = 4 * 3.141592653589793 / 780e-9
        out["phase_rad"] = kasevich_chu_phase(k, 9.80665, q["time"])
        out["assumptions_used"] = ["Rb-87 two-photon k_eff at 780 nm", "standard gravity g_n"]
    elif cfg.family == "orbit":
        from .gravity import perihelion_precession_numeric, perihelion_precession_analytic
        out["mercury_precession_rad_per_orbit"] = {"numeric": perihelion_precession_numeric(1.98847e30, 5.7909e10, 0.2056),
                                                   "analytic": perihelion_precession_analytic(1.98847e30, 5.7909e10, 0.2056)}
    return out


# ----------------------------------------------------------------------------- optional language model
LM_SCHEMA = {
    "type": "object",
    "properties": {
        "family": {"type": "string", "enum": list(FAMILIES) + ["unsupported"]},
        "category": {"type": "string", "enum": ["THEORETICAL", "COMPUTATIONAL", "VIRTUAL", "PHYSICAL"]},
        "geometry": {"type": "string", "enum": ["parallel", "linear"]},
        "material": {"type": "string", "enum": list(materials.MATERIALS)},
        "quantities": {"type": "array", "items": {
            "type": "object",
            "properties": {"role": {"type": "string", "enum": ["mass", "separation", "branch_separation", "time",
                                                                 "temperature", "pressure", "frequency"]},
                           "value": {"type": "number"}, "unit": {"type": "string"},
                           "stated_by_user": {"type": "boolean"}},
            "required": ["role", "value", "unit", "stated_by_user"], "additionalProperties": False}},
        "speculative": {"type": "boolean"},
        "clarifying_questions": {"type": "array", "items": {"type": "string"}},
        "physical_question": {"type": "string"},
    },
    "required": ["family", "category", "geometry", "material", "quantities", "speculative",
                 "clarifying_questions", "physical_question"],
    "additionalProperties": False,
}

LM_SYSTEM = (
    "You translate a researcher's natural-language thought experiment about gravity and quantum physics into a "
    "configuration for a deterministic simulation platform. Choose the closest supported family or 'unsupported'. "
    "Extract only quantities the researcher stated (stated_by_user=true); if a required quantity is missing you may "
    "propose a typical value with stated_by_user=false. Use units among: kg, g, mg, ng, pg, fg, amu, m, mm, um, nm, "
    "s, ms, us, K, mK, Pa, mbar, Torr. Never state predictions, results or measurements: the platform computes those. "
    "Mark speculative=true for physics beyond weak-field gravity and non-relativistic quantum mechanics. Ask "
    "clarifying questions for essential ambiguities."
)


def lm_status() -> dict:
    """Which providers are configured on this server (keys are never returned)."""
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
    return {"providers": {"anthropic": {"configured": has_anthropic, "default_model": "claude-opus-5-5"},
                          "ollama": {"configured": bool(os.environ.get("QGDEVS_OLLAMA_URL")),
                                     "url": os.environ.get("QGDEVS_OLLAMA_URL", "http://localhost:11434")}},
            "default": "off"}


def _from_lm_json(prompt: str, data: dict, interpreter: str) -> ThoughtConfig:
    fam = data.get("family")
    cfg = ThoughtConfig(prompt=prompt, family=None if fam == "unsupported" else fam,
                        category=data.get("category", "THEORETICAL"), material=data.get("material", "diamond"),
                        geometry=data.get("geometry", "parallel"), speculative=bool(data.get("speculative")),
                        interpreter=interpreter)
    for q in data.get("quantities", []):
        unit = {"µm": "um", "μm": "um"}.get(q["unit"], q["unit"])
        try:
            si, _ = to_si(float(q["value"]), unit) if unit != "rad/s" else (float(q["value"]), "frequency")
        except ValueError:
            cfg.domain_notes.append(f"language model proposed an unsupported unit '{q['unit']}' for {q['role']}: ignored")
            continue
        src = "USER_STATED" if q.get("stated_by_user") else "LM_PROPOSED"
        if src == "USER_STATED" and str(q["value"]) not in prompt and f"{q['value']:g}" not in prompt:
            src = "LM_PROPOSED"  # cannot be verified against the prompt text: treat as a proposal
        cfg.quantities[q["role"]] = Quantity(q["role"], float(q["value"]), q["unit"], si, src)
        if src == "LM_PROPOSED":
            cfg.assumptions.append(f"{q['role']} = {q['value']} {q['unit']} proposed by the language model — review")
    cfg.clarifications += data.get("clarifying_questions", [])
    if data.get("physical_question"):
        cfg.assumptions.insert(0, f"interpreted question: {data['physical_question']}")
    return finalise(cfg)


def interpret_with_language_model(prompt: str, provider: str = "anthropic", model: str | None = None) -> ThoughtConfig:
    if provider == "anthropic":
        import anthropic
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
            raise RuntimeError("no Anthropic credentials configured on the server")
        client = anthropic.Anthropic()
        resp = client.beta.messages.create(
            model=model or "claude-opus-5-5", max_tokens=4000, system=LM_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": LM_SCHEMA}},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError("the language model declined this request; use the deterministic interpreter")
        text = next(b.text for b in resp.content if b.type == "text")
        return _from_lm_json(prompt, json.loads(text), f"anthropic:{resp.model}")
    if provider == "ollama":
        import httpx
        url = os.environ.get("QGDEVS_OLLAMA_URL", "http://localhost:11434")
        r = httpx.post(f"{url}/api/chat", timeout=120, json={
            "model": model or os.environ.get("QGDEVS_OLLAMA_MODEL", "llama3.1"), "stream": False,
            "format": LM_SCHEMA, "messages": [{"role": "system", "content": LM_SYSTEM},
                                              {"role": "user", "content": prompt}]})
        r.raise_for_status()
        return _from_lm_json(prompt, json.loads(r.json()["message"]["content"]), f"ollama:{model or 'default'}")
    raise ValueError(f"unknown provider '{provider}'")


def interpret(prompt: str, language_model: str = "off", model: str | None = None) -> ThoughtConfig:
    """Entry point honouring the Language Model ON/OFF switch; falls back to deterministic on LM failure."""
    if language_model in ("off", None, ""):
        return interpret_deterministic(prompt)
    try:
        return interpret_with_language_model(prompt, language_model, model)
    except Exception as exc:
        cfg = interpret_deterministic(prompt)
        cfg.domain_notes.append(f"language model unavailable ({exc}); deterministic interpreter used")
        return cfg
