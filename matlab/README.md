# Optional MATLAB / GNU Octave bridge

QG-DEVS runs entirely on its open Python/C++ implementations; MATLAB is **never required**.
These functions let licensed MATLAB users (or GNU Octave users) reproduce core calculations independently
and cross-check them against the platform:

| Function | Mirrors |
|---|---|
| `bmv_entangling_phase.m` | `qgdevs.bmv` branch phases, Δφ (point masses) |
| `lindblad_rk4.m` | `qgdevs.quantum.evolve_lindblad_rk4_fixed` |
| `negativity2.m` | `qgdevs.quantum.negativity` |

Python access: `qgdevs.matlab_bridge` uses the MATLAB Engine API for Python (`matlab.engine`, shipped with a
licensed MATLAB installation) when available, otherwise `octave-cli` if installed; `available()` reports which.
Tests in `tests/test_matlab_bridge.py` are skipped when neither is present.
