# Requirements traceability matrix

Objective → suite → implementation → verification → status. Status vocabulary:
**DONE** (implemented and tested) · **PARTIAL** (strongest defensible baseline; gap documented) ·
**EXTERNAL** (needs hardware, data, accounts or people not available to software) · **OPEN** (not yet implemented).
Test references are pytest node IDs or V&V benchmark IDs (`qgdevs/vv.py`, run by `tests/test_vv.py`).

## A. Scientific objectives (master spec §3, directive §2)

| # | Objective | Suites | Implementation | Verification | Status |
|---|---|---|---|---|---|
| A1 | Can gravity mediate entanglement between massive systems? | 4, 12 | `bmv.py`, `models.py` (QG-COH) | S4-concurrence-formula, S4-analytic-vs-lindblad, S4-parallel-closed-form | DONE (computational) / EXTERNAL (physical) |
| A2 | Do measurable effects require quantum gravitational degrees of freedom (under stated assumptions)? | 12 | `models.py` (CC-KTM, SC-MF, NULL-NG), `discrimination.py` | test_classical_models_never_entangle_by_gravity, S12-known-distinguishable | DONE for implemented models |
| A3 | Can classical gravity reproduce "quantum-gravity" observables? | 12 | CG-QFT-AH registered | — | OPEN (registered, not implemented) |
| A4 | Do hybrid theories give distinguishable predictions? | 12, 13 | CC-KTM with κ nuisance; robust KL | calibration_tradeoff study; docs/FLAGSHIP_RESULTS.md | DONE |
| A5 | Measurable corrections beyond classical gravity | 3 | `qg_eft.py` one-loop | S12-known-indistinguishable | PARTIAL (only EFT one-loop) |
| A6 | Gravity's influence on phases, coherence, interference, statistics | 4, 5, 6 | `bmv.py`, `interferometry.py`, `optomech.py` | S5-*, S6-* | DONE |
| A7 | Can EM/decoherence/noise imitate the signal? | 7, 8, 10 | `decoherence.py`, `em.py`, `sigproc.py`, NULL-NG | S7-dp-closed-form, S8-casimir-scaling, test_api::test_synthetic_label_and_jobs | DONE (patch potentials, magnetism: OPEN) |
| A8 | New relationships/scaling laws emerging from computation | 14 | `discovery.py` | S14-blind-law-recovery; calibration_tradeoff | DONE (novelty assessment EXTERNAL) |
| A9 | Configurations giving strongest evidence | 13 | `design.py` two-stage optimisation | FLAGSHIP_RESULTS §6 | DONE |
| A10 | Observations that would falsify hypotheses | 9, 12, 18 | dossier `9_decision_rules`, `10_falsification` | test_dossier_contains_required_sections | DONE |

## B. The 18 suites (master spec §6) — see `docs/SUITES.md` for maturity and gaps

| Suite | Key requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| 1 | Hamiltonians, density matrices, Lindblad, trajectories, tomography | `quantum.py` | S1-* (10 benchmarks) | DONE |
| 2 | Newtonian, weak-field, geodesics | `gravity.py` | S2-* (7) | DONE (3+1 NR: OPEN, not needed for lab scale) |
| 3 | Labelled candidate QG models / EFT | `qg_eft.py`, `models.py` | S12-known-indistinguishable | PARTIAL |
| 4 | Branch phases, witnesses, BMV observables | `bmv.py` | S4-* (5) | DONE |
| 5 | Interferometry, SG splitting | `interferometry.py` | S5-* (3) | DONE |
| 6 | Optomechanics | `optomech.py` | S6-* (2) | DONE (cavity field: OPEN) |
| 7 | Decoherence, collapse alternatives | `decoherence.py` | S7-dp-closed-form | DONE (CSL: OPEN) |
| 8 | EM and environmental backgrounds | `em.py` | S8-casimir-scaling, test_infeasible_configurations_identified | PARTIAL |
| 9 | Virtual lab, protocols, hardware interface | `lab.py`, `instruments.py` | test_dossier_*, test_instrument_safety | DONE / EXTERNAL (no device) |
| 10 | Acquisition, noise, weak-signal detection | `sigproc.py` | test_synthetic_data_always_labelled, injection–recovery endpoint | DONE |
| 11 | Bayesian estimation, model selection, identifiability | `inference.py` | parameter-recovery runs (FLAGSHIP §4) | DONE |
| 12 | Theory-neutral comparison engine | `models.py`, `discrimination.py` | S12-* | DONE |
| 13 | Optimal design, EIG, feasibility | `design.py` | FLAGSHIP §6 | DONE |
| 14 | Symbolic regression, hypothesis records | `discovery.py` | S14-blind-law-recovery | DONE |
| 15 | C++/Python HPC, checkpoints, distributed | `cpp/`, `native.py`, `jobs.py` | tests/test_native.py (18), test_job_queue_recovery | DONE (GPU: OPEN) |
| 16 | V&V, convergence, independent implementations, Lean | `vv.py`, `lean/` | 33 benchmarks; Lean `check.sh` | DONE |
| 17 | Data ingestion, provenance, formats | `data.py` | connector live tests (manual), test_backup_restore_roundtrip | DONE |
| 18 | Preregistration, blinding, gates, replication | `evidence.py` | test_preregistration_blind_vault, test_reproduction_package, test_no_physical_claim_without_real_data | DONE (G4/G6/G7 EXTERNAL) |

## C. Directive: experimental setup, thought experiments, language model

| Requirement | Implementation | Verification | Status |
|---|---|---|---|
| 18-section experimental dossier | `lab.generate_dossier` | test_dossier_contains_required_sections | DONE |
| Laboratory Protocol + Engineering Specification linked to the same models | `lab.py` (protocol, engineering, consistency_check) | test_dossier_numbers_come_from_physics | DONE |
| Provenance statuses for every number; costs never invented | status legend; `cost = "quotation required"` | test_dossier_contains_required_sections | DONE |
| 2-D drawings, 3-D models, CAD interchange | SVG, STL, scene JSON (STEP: OPEN) | test_geometry_exports | PARTIAL |
| Thought-experiment lab: 18-step investigation | `thought.py` + web Thought Lab | test_thought_experiment_produces_reviewable_config, test_missing_and_speculative_inputs_flagged | DONE |
| Language Model ON/OFF, provider choice, local model | `thought.interpret(language_model=…)`: off / Anthropic API / Ollama | test_language_model_toggle, test_language_model_output_is_validated_and_labelled | DONE |
| LM cannot execute, fabricate or bypass validation | approval gate; LM_PROPOSED labels; same `finalise` | test_execution_requires_approval_and_uses_solvers | DONE |
| Thought / computational / virtual / physical distinction | `ThoughtConfig.category`; evidence ladder | test_no_physical_claim_without_real_data | DONE |

## D. Evidence gates (Part II §C)

| Gate | Software support | Can software pass it alone? | Current status |
|---|---|---|---|
| G1 Theory | registry G1 records, known-limit benchmarks | No — needs independent review sign-off | REQUIRES_HUMAN |
| G2 Novel prediction | second implementation (C++) + literature connectors | No — needs DOI-linked review | PARTIAL |
| G3 Solver assurance | 33 V&V benchmarks + Lean proofs | Yes | see `docs/VV_REPORT.md` |
| G4 Feasibility | dossier, TRL table | No — experimental team must confirm; TRL < 4 | NOT PASSED |
| G5 Preregistration | hash-chained ledger | Yes | available |
| G6 Experimental result | blind vault, REAL labels, instrument framework | No — needs physical data | NOT PASSED |
| G7 Replication | reproduction packages | No — needs independent laboratories | NOT PASSED |

## E. Platform requirements

| Requirement | Implementation | Status |
|---|---|---|
| C++ / Python / optional MATLAB / Lean 4 | `cpp/`, `qgdevs/`, `matlab/` + `matlab_bridge.py`, `lean/` | DONE (MATLAB untested here: no licence/Octave) |
| PWA, install button, offline, sync queue | `web/` | see web build report |
| Back/forward navigation, 18-suite nav, modes | `web/` | see web build report |
| 2-D/3-D solver-linked visualisation | `web/` (canvas plots, three.js) | see web build report |
| Cloud operation independent of developer PC and GitHub | Dockerfile, fly.toml, render.yaml, compose, `deploy/deploy-local.sh`, worker scheduler | EXTERNAL — needs hosting accounts to go live |
| Scheduled ingestion, backups, recovery | `jobs.SCHEDULE`, `backup.py` | DONE (off-site target needs credentials) |
| Security: tokens, validation, rate limits, sandboxed parsing, immutable raw data | `api.py`, `evidence.py`, `data.parse_upload` (no pickle) | DONE (external pen-test: OPEN) |
| No AI/bot branding; honest provenance | repository-wide | DONE |
