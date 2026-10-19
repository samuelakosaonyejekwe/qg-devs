"""Generate documentation that must stay consistent with the code:
docs/MODEL_REGISTRY.md, docs/VV_REPORT.md, docs/SUITES.md.

Usage: .venv/bin/python tools/gen_docs.py [--slow]
"""
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from qgdevs import __version__, models, vv  # noqa: E402
from qgdevs.suites import SUITES  # noqa: E402
from qgdevs.evidence import code_hash  # noqa: E402

DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)
now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

# ---------------------------------------------------------------- model registry
lines = [f"# Scientific model registry\n\nGenerated {now} from `qgdevs/models.py` (version {__version__}). "
         "Each entry is the model's G1 (theory gate) record. No model is privileged; all are evaluated through the "
         "same measurement chain and nuisance treatment.\n"]
for h in models.HYPOTHESES.values():
    m = h.meta
    lines += [f"## {h.id} — {h.name}\n",
              f"* **Family:** {h.family}  ·  **Implemented:** {'yes' if h.implemented else 'NO (registered only)'}  ·  "
              f"**Assurance:** {m['assurance']}",
              f"* **Gravity can entangle:** {m['entangling_by_gravity']}",
              f"* **Dynamics:** {m['dynamics']}",
              "* **Assumptions:** " + "; ".join(m["assumptions"]),
              "* **Approximations:** " + ("; ".join(m["approximations"]) or "—"),
              f"* **Admissible domain:** {m['admissible_domain']}",
              "* **Known limits:** " + ("; ".join(m["known_limits"]) or "—"),
              "* **Nuisance parameters:** " + "; ".join(f"`{n.name}` ∈ [{n.low}, {n.high}] {n.unit} — {n.description}"
                                                       for n in h.nuisance),
              "* **References:** " + "; ".join(m["references"]),
              f"* **Status note:** {m['status_note']}\n"]
(DOCS / "MODEL_REGISTRY.md").write_text("\n".join(lines))

# ---------------------------------------------------------------- V&V report
rep = vv.run(include_slow="--slow" in sys.argv)
s = rep["summary"]
lines = ["# Verification & validation report\n",
         f"Generated {now} · QG-DEVS {__version__} · code SHA-256 `{code_hash()[:16]}…` · Python {platform.python_version()} "
         f"· {platform.platform()}\n",
         f"**{s['passed']} / {s['total']} benchmarks passed, {s['failed']} failed.**"
         + ("" if "--slow" in sys.argv else " (slow statistical benchmarks excluded; run with --slow)") + "\n",
         "Tolerances were fixed in advance with the justification shown (gate G3). A passing verification "
         "benchmark shows the software solves its equations correctly; it is **not** evidence that any physical "
         "theory is correct.\n",
         "| Result | ID | Suite | Kind | Value | Tolerance | Justification | Reference | s |", "|---|---|---|---|---|---|---|---|---|"]
for r in rep["results"]:
    val = "error" if r["value"] is None else f"{r['value']:.3e}"
    tol = ("≥ " if r["compare"] == "min_value" else "≤ ") + f"{r['tolerance']:.1e}"
    lines.append(f"| {'PASS' if r['passed'] else '**FAIL**'} | `{r['id']}` | {r['suite']} | {r['kind']} | {val} | {tol} | "
                 f"{r['justification']} | {r['reference']} | {r['seconds']} |")
lean = ROOT / "lean" / "proof_status.json"
if lean.exists():
    st = json.loads(lean.read_text())
    th = st.get("theorems", [])
    lines += ["\n## Lean 4 formal verification\n",
              f"{sum(t['status'] == 'proved' for t in th)} proved · {sum(t['status'] == 'partial' for t in th)} partial · "
              f"{sum(t['status'] == 'open' for t in th)} open (from `lean/proof_status.json`; machine-checked by `lean/check.sh`).\n",
              "| Status | Lean name | Statement |", "|---|---|---|"]
    for t in th:
        lines.append(f"| {t['status']} | `{t.get('lean_name', t.get('name', ''))}` | {t.get('informal_statement', t.get('statement', ''))} |")
(DOCS / "VV_REPORT.md").write_text("\n".join(lines) + "\n")

# ---------------------------------------------------------------- suites
lines = [f"# The 18 scientific suites — implementation maturity\n\nGenerated {now} from `qgdevs/suites.py`.\n",
         "| # | Suite | Maturity | Modules | Documented gaps |", "|---|---|---|---|---|"]
for x in SUITES:
    lines.append(f"| {x['n']} | {x['name']} | {x['maturity']} | {', '.join('`'+m+'`' for m in x['modules'])} | "
                 f"{'; '.join(x['gaps']) or '—'} |")
(DOCS / "SUITES.md").write_text("\n".join(lines) + "\n")
print(json.dumps(s))
