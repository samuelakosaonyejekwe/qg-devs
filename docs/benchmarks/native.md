# Suite 15 — native kernel benchmark (`libqgdevs_native`)

Measured numbers only. Machine: Intel Core i5-7300U @ 2.60 GHz (2 cores / 4 hardware threads),
WSL2 (Linux 6.18.33.1-microsoft-standard-WSL2), g++ 13.3.0, Python 3.12.3, numpy 2.3.5.

**Caveat — shared machine.** The host was running unrelated workloads during the measurement
(load average ≈ 7.5–10.5 on 4 logical CPUs, recorded by the script). Absolute timings are therefore
pessimistic and noisy: across runs in the same session the single-thread 64 000-point sweep took
between 1.3 s (an earlier build of the same algorithms) and 3.9 s. Only 2 physical cores exist, so the 4-thread speed-up is bounded by about 2–2.5×.

## Commands

```bash
make -C cpp            # cpp/build/libqgdevs_native.so  (-O3 -march=x86-64-v2 -fopenmp -fPIC -fcx-limited-range)
.venv/bin/python cpp/bench.py        # --repeat 3 (default): best of 3 for native/expm, single run for numpy loop and rk
```

## Results (2026-10-19)

```
# host: AKOSA | x86_64 | os.cpu_count()=4 | OpenMP max threads=4 | numpy 2.3.5 | Python 3.12.3
# load average at start (1, 5, 15 min): 10.46 9.55 5.95

## BMV sweep 40x40x40 = 64000 points (delta_phi, negativity, concurrence, witness, purity)
native, 1 thread         :    3.8798 s  (16,496 points/s)
native, 4 threads        :    1.3950 s  (45,877 points/s)
numpy per-point loop     :  275.0842 s  (233 points/s)
speed-up (all threads)   :     197.2 x   (1 thread: 70.9 x)
max |native - numpy|     : delta_phi=0.0e+00, negativity=8.3e-16, concurrence=1.1e-12, witness=0.0e+00

## Lindblad, 4 qubits (d=16, Liouvillian 256x256), 101 output times on [0, 10] s, 4 dephasing ops
native DOPRI5 (rtol=1e-10, atol=1e-12):    0.3712 s  [1404 accepted, 0 rejected steps, 8426 RHS evals]
python evolve_lindblad expm           :    0.1707 s
python evolve_lindblad rk (DOP853)    :    0.3355 s
max |native - expm| = 5.9e-11, max |rk - expm| = 2.1e-11

# load average at end (1, 5, 15 min): 7.57 9.72 7.17
```

## Setup

* **Sweep grid:** mass ∈ geomspace(1e-15, 1e-13 kg, 40) × separation ∈ linspace(300 µm, 1 mm, 40) ×
  time ∈ linspace(0.1, 5 s, 40); dx = 250 µm, Γ_A = Γ_B = 0.1 s⁻¹, parallel geometry. Each point
  produces Δφ, negativity (partial transpose + Jacobi), Wootters concurrence, the sign-optimised CPK
  witness after local Z correction, and purity.
* **numpy baseline:** a per-point loop over the reference API (`bmv.gravitational_branch_energies(finite_size=False)`,
  `bmv.joint_state`, `quantum.negativity`, `quantum.concurrence`, `bmv.cpk_witness_best_sign`).
* **4-qubit Lindblad:** H/ħ = Σ Z_kZ_{k+1} + 0.7 Σ X_k (rad/s), L_k = √0.05 Z_k, ρ0 = |+⟩⟨+|^{⊗4}.

## Reading the numbers

* The sweep is where the native kernel matters: ~70× (1 thread) and ~200× (4 threads) faster than
  the numpy loop, with agreement to round-off. The 1.1e-12 concurrence difference comes from the
  reference formula `sqrt|eig(ρρ̃)|`, not from the kernel (see `tests/test_native.py::concurrence_reference`).
* For a single d = 16 Lindblad trajectory the C++ DOPRI5 (dense 16×16 matrix products, no BLAS) is
  *not* faster than SciPy's sparse Krylov `expm_multiply`, and is comparable to SciPy's DOP853 on the
  256×256 Liouvillian. Its value there is as an independent implementation for cross-checks; the
  Python `expm` path remains the faster choice for single linear trajectories at this size.
