# Development checkpoint and resume instructions

_Last updated: 2026-10-19._

## State

- Scientific core: all 18 suites have working modules (maturity in `docs/SUITES.md`).
- V&V: 33/33 benchmarks pass (`docs/VV_REPORT.md`). pytest covers workflows, the API, the native kernel and the
  MATLAB bridge (the bridge tests skip when no MATLAB/Octave is installed).
- Independent C++ kernel: built by `make -C cpp`; 18 comparison tests.
- Flagship study: `tools/flagship_study.py` → `docs/FLAGSHIP_RESULTS.md`.
- Lean 4 project: `lean/` (status in `lean/proof_status.json`).
- Web app: `web/` (PWA).
- Deployment configuration exists, but nothing is deployed — this needs hosting accounts (`docs/DEPLOYMENT.md`).

## Resume

```bash
cd /home/akosa/grqg
.venv/bin/pytest -q                       # everything green?
.venv/bin/python tools/gen_docs.py --slow # regenerate registry / V&V / suites docs
(cd lean && ./check.sh)                   # machine-check proofs
(cd web && npm test && npm run build)
```

## Next scientific milestones (in order)

1. Implement the Aziz–Howl classical-gravity + quantum-matter mechanism (CG-QFT-AH) from the paper's derivation,
   so that a positive witness can be tested against it.
2. Run a DOI-linked literature review of the calibration trade-off relation s* = 1 + |Δφ|/(2Γt). Record it in the
   hypothesis ledger to settle gate G2 novelty.
3. Add the CSL collapse model, patch-potential and magnetic backgrounds, and the Stern–Gerlach Humpty-Dumpty
   (imperfect recombination) loss.
4. Extend discrimination to the Gaussian oscillator family (Suite 6) and to time-resolved witness scaling.
5. Partner with an experimental group: replace estimated or assumed BOM entries with supplier-confirmed ones,
   adapt the instrument interfaces, and run preregistered blinded tests (gates G4–G7).
