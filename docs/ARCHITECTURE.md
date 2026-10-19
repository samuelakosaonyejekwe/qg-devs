# Architecture

```
            ┌──────────────────────── web/ (PWA) ────────────────────────┐
 browser ── │ 18 suites · thought lab · 2-D canvas plots · 3-D (three.js) │
 / phone    │ service worker cache · IndexedDB projects + sync queue      │
            │ local TS engine (offline) · opt-in Web-Worker compute       │
            └───────────────┬─────────────────────────────────────────────┘
                            │ HTTPS JSON (/api/*)
            ┌───────────────▼──────────────── qgdevs.api (FastAPI) ───────┐
            │ validation · bearer-token roles · rate limits · gzip       │
            │ interactive (bounded) endpoints        │ job submission    │
            └──────────┬─────────────────────────────┴──────────┬────────┘
                       │ library calls                          │ SQLite (WAL)
   ┌───────────────────▼──────────────────────┐   ┌─────────────▼──────────────┐
   │ scientific core (library modules)        │   │ qgdevs.jobs worker          │
   │ quantum · gravity · qg_eft · bmv ·       │◄──┤ claim/heartbeat/checkpoint │
   │ interferometry · optomech · decoherence ·│   │ scheduler: ingestion,      │
   │ em · models · discrimination · design ·  │   │ nightly V&V, discovery,    │
   │ sigproc · inference · discovery · lab ·  │   │ daily backups              │
   │ thought · evidence · data · instruments  │   └─────────────┬──────────────┘
   └──────┬──────────────┬───────────────┬────┘                 │
          │ ctypes       │ optional      │                       ▼
   ┌──────▼─────┐ ┌──────▼──────┐ ┌──────▼──────┐   /data: jobs.db · catalogue.db ·
   │ cpp/ C++17 │ │ matlab/     │ │ lean/ Lean 4 │   ledger.jsonl · vault/ · store/ ·
   │ kernel     │ │ MATLAB/Octave│ │ + Mathlib   │   results/ · checkpoints/ · backups/
   └────────────┘ └─────────────┘ └─────────────┘   (snapshots → S3-compatible store)
```

## Design decisions

* **Library modules, not microservices.** The suites are Python modules with stable function interfaces; the API
  and worker are thin layers. This keeps scientific code testable without a network (spec §13).
* **One measurement chain for every hypothesis.** `discrimination.MeasurementChain` and the protocol frame are
  fixed in advance, so no hypothesis is advantaged by the analysis.
* **Three independent numerical implementations of the flagship physics:** Python (reference), C++ (`cpp/`) and
  TypeScript (`web/src/engine/`). They are cross-checked by tests against golden vectors. The C++ comparison has
  already found and fixed three defects in the Python reference.
* **Durable jobs.** Long computations run in the worker with heartbeats and checkpoints and resume after a crash.
  No result depends on a browser tab staying open.
* **Provenance first.** Every dataset carries a label (REAL, SYNTHETIC, REFERENCE, LITERATURE, TRAINING) and a hash.
  Every evidence action is appended to the hash-chained ledger, and blind-test data are sealed until a
  preregistered unblinding.
* **Language models are advisory.** They only propose configurations. These pass the same validation as the
  deterministic interpreter and need human approval before anything executes. Language models can never authorise
  instruments.

## Numerical methods by problem

| Problem | Method | Why |
|---|---|---|
| Unitary evolution | eigendecomposition of Hermitian H | exact up to round-off and unitary by construction |
| Lindblad (small d) | Krylov `expm_multiply` on the sparse Liouvillian | exact propagator action; cross-checked by DOP853 and C++ DOPRI5 |
| Quantum jumps | MCWF unravelling | statistical cross-check of the master equation |
| BMV state with dephasing | closed form (dephasing commutes with H) | exact; verified against Lindblad |
| Overlapping spheres | 1-D shell quadrature | needed for Diósi–Penrose self-energy |
| N-body | velocity-Verlet (symplectic) + DOP853 reference | bounded energy error; independent check |
| Geodesics | Binet-form ODE with event location | perihelion and deflection benchmarks |
| Wave packets | Strang split-step Fourier | exact free propagation; 2nd-order splitting |
| Oscillator entanglement | covariance-matrix Lyapunov ODE | exact for Gaussian states |
| Discrimination | nuisance-minimised KL divergence (Nelder–Mead, multi-start) | expected information per shot after admissible nuisance adjustment |
| Design | differential evolution, then robust re-ranking | global search under hard constraints (multi-fidelity) |
| Inference | adaptive Metropolis; Laplace and Savage–Dickey evidence; bootstrap LRT | cross-validated estimators |
| Law discovery | log-linear regression, exponent rationalisation, dimensional completion; STLSQ | interpretable and dimensionally checked |
