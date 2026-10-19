# QG-DEVS — Quantum Gravity Discovery and Experimental Verification System

A research platform for predicting, designing, analysing and independently testing experiments on the quantum
nature of gravity, centred on gravity-mediated entanglement between massive quantum systems.

> **What this is and is not.** QG-DEVS computes predictions, compares competing theories under equal assumptions,
> designs experiments and analyses data with full provenance. It has **not** observed anything about nature: all
> results produced so far are computational predictions or SYNTHETIC data. A claim about the physical nature of
> gravity requires authentic laboratory measurements, preregistered analysis and independent replication
> (evidence gates G4–G7), which software alone cannot supply.

## What it does

- **Flagship study** (`docs/FLAGSHIP_RESULTS.md`): reproduces the Bose–Marletto–Vedral benchmark. It then quantifies
  decoherence, Casimir, charge and Diósi–Penrose effects, compares six implemented hypotheses (quantum-coherent,
  one-loop EFT, semiclassical mean-field, classical measurement–feedback, Diósi–Penrose collapse, and a
  non-gravitational null), and computes how many measurement shots are needed to distinguish them once every
  hypothesis may adjust its admissible nuisance parameters.
- **18 scientific suites** (`docs/SUITES.md`), from quantum dynamics and numerical gravity to evidence management.
  Each suite's maturity and gaps are stated plainly.
- **Experimental dossiers** with two linked parts: a Scientific Laboratory Protocol and an Engineering Apparatus
  Specification. Tolerances, vacuum, temperature and charge limits are calculated from the physics, and every
  number carries a provenance status.
- **Thought-Experiment Laboratory**: type a physical scenario in natural language and get a reviewable
  configuration. The optional language model (Anthropic API or a local Ollama model) is off by default and is never
  needed.
- **Verification**: 33 benchmarks with tolerances justified in advance, an independent C++ implementation that is
  cross-checked against Python, and Lean 4 machine-checked theorems.
- **Evidence integrity**: a hash-chained ledger, preregistration, a blind-data vault, the seven acceptance gates,
  an evidence ladder and reproduction packages.

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[test,llm]"
make -C cpp                                   # optional native kernel (C++17, OpenMP)
(cd web && npm ci && npm run build)           # web app (PWA)
.venv/bin/python -m qgdevs.cli serve          # API + web app on http://localhost:8000
.venv/bin/python -m qgdevs.cli worker         # job worker + scheduler (separate terminal)
.venv/bin/pytest -q                           # full test suite
.venv/bin/python tools/flagship_study.py      # regenerate the flagship results
```

The API reference is served at `/api/docs`. The CLI provides `predict`, `dossier`, `vv`, `reproduce`, `worker`
and `serve`.

## Repository map

| Path | Contents |
|---|---|
| `qgdevs/` | Python scientific core, API, job queue, evidence system |
| `cpp/` | C++17 high-performance kernel with a C ABI (`native.py` binding) |
| `lean/` | Lean 4 + Mathlib formal verification project (`proof_status.json`, `check.sh`) |
| `matlab/` | Optional MATLAB / GNU Octave cross-check functions |
| `web/` | Installable offline-capable web application |
| `tools/` | Reproducible studies and documentation generators |
| `deploy/`, `Dockerfile`, `fly.toml`, `render.yaml`, `docker-compose.yml` | Deployment and recovery |
| `docs/` | Traceability matrix, architecture, model registry, V&V report, results, deployment, checkpoint |

## Citing the physics

The scientific basis is cited in `docs/MODEL_REGISTRY.md`. Principal references: Bose et al., PRL 119, 240401
(2017); Marletto & Vedral, PRL 119, 240402 (2017); Aziz & Howl, Nature 646, 813 (2025); Kafri, Taylor & Milburn,
NJP 16, 065020 (2014); Diósi, PRA 40, 1165 (1989); Penrose, GRG 28, 581 (1996); Bjerrum-Bohr, Donoghue & Holstein,
PRD 67, 084033 (2003); Chevalier, Paige & Kim, PRA 102, 022428 (2020); Romero-Isart, PRA 84, 052121 (2011).

## Licence

All rights reserved by the repository owner until a licence is chosen. Third-party dependencies keep their own
licences (`pyproject.toml`, `web/package.json`).
