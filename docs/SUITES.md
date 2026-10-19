# The 18 scientific suites — implementation maturity

Generated 2026-10-19 13:50 UTC from `qgdevs/suites.py`.

| # | Suite | Maturity | Modules | Documented gaps |
|---|---|---|---|---|
| 1 | Quantum Mechanics and Quantum-State Dynamics | IMPLEMENTED_VERIFIED | `qgdevs.quantum` | tensor-network methods for many-body states not implemented |
| 2 | Classical Gravitation and Numerical Relativity | IMPLEMENTED_VERIFIED | `qgdevs.gravity` | 3+1 numerical relativity (BSSN) not implemented; not required for lab-scale tests |
| 3 | Quantum Gravity and Effective Field Theory | BASELINE | `qgdevs.qg_eft`, `qgdevs.models` | graviton-mediated decoherence, QFT in curved spacetime, path integrals: staged research items |
| 4 | Gravity-Mediated Entanglement and Quantum Information | IMPLEMENTED_VERIFIED | `qgdevs.bmv` | — |
| 5 | Quantum and Matter-Wave Interferometry | IMPLEMENTED_VERIFIED | `qgdevs.interferometry` | spin–motion coupling beyond ideal recombination (Humpty-Dumpty) not modelled |
| 6 | Quantum Optomechanics and Massive Quantum Systems | IMPLEMENTED_VERIFIED | `qgdevs.optomech` | full cavity-field dynamics and measurement-based feedback cooling |
| 7 | Quantum Decoherence and Open Systems | IMPLEMENTED_VERIFIED | `qgdevs.decoherence`, `qgdevs.quantum` | CSL collapse model registered for future implementation |
| 8 | Electromagnetic and Environmental Interaction Physics | IMPLEMENTED_VERIFIED | `qgdevs.em` | patch potentials, magnetic and vibration-noise models: staged |
| 9 | Virtual Laboratory and Experimental Apparatus | IMPLEMENTED | `qgdevs.lab`, `qgdevs.instruments` | no physical instrument connected (Environment B requires a partner laboratory); STEP export not implemented |
| 10 | Precision Measurement and Signal Processing | IMPLEMENTED_VERIFIED | `qgdevs.sigproc` | instrument-native raw-format adapters (TDMS, vendor) pending partner data |
| 11 | Inverse Physics and Statistical Inference | IMPLEMENTED_VERIFIED | `qgdevs.inference` | hierarchical multi-run models |
| 12 | Competing Gravity Models and Scientific Falsification | IMPLEMENTED_VERIFIED | `qgdevs.models`, `qgdevs.discrimination` | Aziz–Howl model PARTIALLY VERIFIED (non-perturbative completion and long-time regime of the paper not implemented) |
| 13 | Experimental Design and Optimisation | IMPLEMENTED | `qgdevs.design` | Bayesian-optimal adaptive design over sequential runs |
| 14 | AI-Driven Physical Law and Hypothesis Discovery | IMPLEMENTED | `qgdevs.discovery` | neural surrogate models; literature-novelty assessment requires human review |
| 15 | High-Performance Numerical Simulation | IMPLEMENTED_VERIFIED | `qgdevs.native`, `cpp/`, `qgdevs.jobs` | GPU kernels not implemented (no GPU in the development environment) |
| 16 | Calibration, Verification, Validation and Uncertainty | IMPLEMENTED_VERIFIED | `qgdevs.vv`, `lean/` | experimental validation requires physical data |
| 17 | Scientific Data, Visualisation and Research Management | IMPLEMENTED | `qgdevs.data` | NetCDF/FITS/VTK writers |
| 18 | Discovery Evidence and Independent Replication | IMPLEMENTED | `qgdevs.evidence` | G4, G6, G7 require experimental partners, physical data and independent replication |
