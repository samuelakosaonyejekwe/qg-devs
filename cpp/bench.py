"""Suite 15 benchmark: C++ kernel (qgdevs.native) vs the Python/numpy reference.

1. BMV sweep on a 40×40×40 grid (mass × separation × time; dx = 250 µm, Γ = 0.1 s^-1, parallel):
   native OpenMP sweep (1 thread and all threads) vs a per-point numpy loop over the bmv/quantum API.
2. 4-qubit (d = 16) Lindblad run: ZZ chain + transverse field, dephasing on every qubit, 101 output
   times: native DOPRI5 vs quantum.evolve_lindblad (expm and rk/DOP853).

Usage:  .venv/bin/python cpp/bench.py [--repeat N]
"""
from __future__ import annotations

import argparse
import os
import platform
import time

import numpy as np

from qgdevs import bmv, native
from qgdevs import quantum as qm


def best_of(fn, repeat):
    best, out = np.inf, None
    for _ in range(repeat):
        t0 = time.perf_counter()
        out = fn()
        best = min(best, time.perf_counter() - t0)
    return best, out


def numpy_sweep(mass, sep, time_, dx, gamma):
    shape = (len(mass), len(sep), len(time_))
    out = {k: np.zeros(shape) for k in ("delta_phi", "negativity", "concurrence", "witness")}
    for i, m in enumerate(mass):
        for j, s in enumerate(sep):
            d = bmv.BMVDesign(mass_A=m, mass_B=m, separation=s, dx_A=dx, dx_B=dx, gamma_A=gamma, gamma_B=gamma)
            E = bmv.gravitational_branch_energies(d, finite_size=False)
            for k, t in enumerate(time_):
                ph = bmv.phases_from_energies(E, t)
                rho = bmv.joint_state(ph, gamma * t, gamma * t)
                U = bmv.local_phase_correction(ph)
                out["delta_phi"][i, j, k] = bmv.entangling_phase(ph)
                out["negativity"][i, j, k] = qm.negativity(rho)
                out["concurrence"][i, j, k] = qm.concurrence(rho)
                out["witness"][i, j, k] = bmv.cpk_witness_best_sign(U @ rho @ U.conj().T)
    return out


def four_qubit_problem():
    n = 4
    dims = [2] * n
    H = np.zeros((16, 16), complex)
    for k in range(n - 1):
        H += 1.0 * qm.embed(qm.Z, k, dims) @ qm.embed(qm.Z, k + 1, dims)
    for k in range(n):
        H += 0.7 * qm.embed(qm.X, k, dims)
    Ls = [np.sqrt(0.05) * qm.embed(qm.Z, k, dims) for k in range(n)]
    psi = qm.kron(*[qm.ket(1, 1)] * n)
    return qm.dm(psi), H, Ls, np.linspace(0.0, 10.0, 101)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=3)
    args = ap.parse_args()
    if not native.available():
        raise SystemExit(f"native library unavailable: {native.unavailable_reason()}")

    print(f"# host: {platform.node()} | {platform.machine()} | os.cpu_count()={os.cpu_count()} | "
          f"OpenMP max threads={native.max_threads()} | numpy {np.__version__} | Python {platform.python_version()}")
    print("# load average at start (1, 5, 15 min): %.2f %.2f %.2f" % os.getloadavg())

    mass = np.geomspace(1e-15, 1e-13, 40)
    sep = np.linspace(300e-6, 1e-3, 40)
    tt = np.linspace(0.1, 5.0, 40)
    dx, gamma = 250e-6, 0.1
    npts = mass.size * sep.size * tt.size

    t1, o1 = best_of(lambda: native.bmv_sweep(mass, sep, [dx], tt, [gamma], nthreads=1), args.repeat)
    tN, oN = best_of(lambda: native.bmv_sweep(mass, sep, [dx], tt, [gamma], nthreads=0), args.repeat)
    tpy, opy = best_of(lambda: numpy_sweep(mass, sep, tt, dx, gamma), 1)
    diffs = {k: float(np.max(np.abs(oN[k][:, :, 0, :, 0] - opy[k]))) for k in opy}
    print(f"\n## BMV sweep 40x40x40 = {npts} points (delta_phi, negativity, concurrence, witness, purity)")
    print(f"native, 1 thread         : {t1:9.4f} s  ({npts / t1:,.0f} points/s)")
    print(f"native, {native.max_threads()} threads        : {tN:9.4f} s  ({npts / tN:,.0f} points/s)")
    print(f"numpy per-point loop     : {tpy:9.4f} s  ({npts / tpy:,.0f} points/s)")
    print(f"speed-up (all threads)   : {tpy / tN:9.1f} x   (1 thread: {tpy / t1:.1f} x)")
    print("max |native - numpy|     : " + ", ".join(f"{k}={v:.1e}" for k, v in diffs.items()))

    rho0, H, Ls, times = four_qubit_problem()
    tn, (rn, st) = best_of(lambda: native.lindblad_dopri(rho0, H, Ls, times, rtol=1e-10, atol=1e-12,
                                                         return_stats=True), args.repeat)
    te, re_ = best_of(lambda: qm.evolve_lindblad(rho0, H, Ls, times, method="expm"), args.repeat)
    tr, rr = best_of(lambda: qm.evolve_lindblad(rho0, H, Ls, times, method="rk"), 1)
    print("\n## Lindblad, 4 qubits (d=16, Liouvillian 256x256), 101 output times on [0, 10] s, 4 dephasing ops")
    print(f"native DOPRI5 (rtol=1e-10, atol=1e-12): {tn:9.4f} s  "
          f"[{st['accepted']} accepted, {st['rejected']} rejected steps, {st['nfev']} RHS evals]")
    print(f"python evolve_lindblad expm           : {te:9.4f} s")
    print(f"python evolve_lindblad rk (DOP853)    : {tr:9.4f} s")
    print(f"max |native - expm| = {np.max(np.abs(rn - re_)):.1e}, max |rk - expm| = {np.max(np.abs(rr - re_)):.1e}")
    print("\n# load average at end (1, 5, 15 min): %.2f %.2f %.2f" % os.getloadavg())


if __name__ == "__main__":
    main()
