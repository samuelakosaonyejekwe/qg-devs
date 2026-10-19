"""Suite 15 — ctypes binding to the C++ numerical kernel ``libqgdevs_native`` (cpp/).

The kernel is an independent implementation (own complex Jacobi eigensolver, Dormand–Prince 5(4)
Lindblad integrator, BMV primitives, velocity-Verlet N-body) used for high-throughput sweeps and as
the cross-implementation check of the Python reference (tests/test_native.py).

Library lookup order: $QGDEVS_NATIVE_LIB, then <repo>/cpp/build/libqgdevs_native.so (build with
``make -C cpp``). If the library is absent every entry point raises NativeUnavailableError and
``available()`` is False; there is no silent fallback to the Python code.
"""
from __future__ import annotations

import ctypes
import os
from pathlib import Path

import numpy as np

ABI_VERSION = 1
GEOMETRIES = {"parallel": 0, "linear": 1, "angled": 2}

_c_int, _c_long, _c_double = ctypes.c_int, ctypes.c_long, ctypes.c_double
_dp = ctypes.POINTER(ctypes.c_double)
_lp = ctypes.POINTER(ctypes.c_long)


class NativeUnavailableError(RuntimeError):
    """The native library could not be loaded."""


class NativeError(RuntimeError):
    """The native library reported a failure (message from qgdevs_last_error)."""


_lib = None
_load_error: str | None = None


def library_path() -> Path:
    env = os.environ.get("QGDEVS_NATIVE_LIB")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "cpp" / "build" / "libqgdevs_native.so"


def _load():
    global _lib, _load_error
    if _lib is not None or _load_error is not None:
        return _lib
    path = library_path()
    try:
        lib = ctypes.CDLL(str(path))
    except OSError as exc:
        _load_error = f"cannot load native library {path}: {exc} (build it with `make -C cpp`)"
        return None
    sig = {
        "qgdevs_abi_version": (_c_int, []),
        "qgdevs_last_error": (ctypes.c_char_p, []),
        "qgdevs_max_threads": (_c_int, []),
        "qgdevs_constants": (None, [_dp]),
        "qgdevs_eigvalsh": (_c_int, [_c_int, _dp, _dp]),
        "qgdevs_negativity": (_c_int, [_dp, _dp]),
        "qgdevs_concurrence": (_c_int, [_dp, _dp]),
        "qgdevs_purity": (_c_int, [_c_int, _dp, _dp]),
        "qgdevs_cpk_witness_best_sign": (_c_int, [_dp, _dp]),
        "qgdevs_lindblad_dopri": (_c_int, [_c_int, _dp, _dp, _c_int, _dp, _c_int, _dp, _c_double, _c_double,
                                           _c_long, _dp, _lp]),
        "qgdevs_lindblad_rk4": (_c_int, [_c_int, _dp, _dp, _c_int, _dp, _c_double, _c_long, _dp]),
        "qgdevs_bmv_point": (_c_int, [_dp, _c_int, _c_int, _dp, _dp, _dp]),
        "qgdevs_bmv_sweep": (_c_int, [_c_int, _dp, _c_int, _dp, _c_int, _dp, _c_int, _dp, _c_int, _dp, _c_int,
                                      _c_double, _c_double, _c_int, _c_int, _dp, _dp, _dp, _dp, _dp]),
        "qgdevs_nbody_verlet": (_c_int, [_c_int, _c_int, _dp, _dp, _dp, _c_double, _c_long, _c_long, _dp, _dp, _dp]),
        "qgdevs_nbody_energy": (_c_int, [_c_int, _c_int, _dp, _dp, _dp, _dp]),
    }
    try:
        for name, (res, args) in sig.items():
            fn = getattr(lib, name)
            fn.restype, fn.argtypes = res, args
    except AttributeError as exc:
        _load_error = f"native library {path} is missing a symbol: {exc}"
        return None
    if lib.qgdevs_abi_version() != ABI_VERSION:
        _load_error = f"native library {path} has ABI {lib.qgdevs_abi_version()}, expected {ABI_VERSION}"
        return None
    _lib = lib
    return _lib


def available() -> bool:
    """True if the native library is built, loadable and ABI-compatible."""
    return _load() is not None


def unavailable_reason() -> str | None:
    _load()
    return _load_error


def _get():
    lib = _load()
    if lib is None:
        raise NativeUnavailableError(_load_error)
    return lib


def _check(status: int, lib) -> None:
    if status != 0:
        raise NativeError(lib.qgdevs_last_error().decode())


def _f64(a) -> np.ndarray:
    return np.ascontiguousarray(a, dtype=np.float64)


def _c128(a) -> np.ndarray:
    return np.ascontiguousarray(a, dtype=np.complex128)


def _ptr(a: np.ndarray):
    return a.ctypes.data_as(_dp)


def max_threads() -> int:
    return int(_get().qgdevs_max_threads())


def constants() -> dict[str, float]:
    """Constants compiled into the kernel (must equal qgdevs.constants)."""
    out = np.zeros(5)
    _get().qgdevs_constants(_ptr(out))
    return dict(zip(["G", "hbar", "h", "c", "k_B"], out.tolist()))


# ----------------------------------------------------------------------------- linear algebra & measures
def eigvalsh(A) -> np.ndarray:
    """Eigenvalues (ascending) of the Hermitian part of A by cyclic complex Jacobi."""
    lib = _get()
    A = _c128(A)
    if A.ndim != 2 or A.shape[0] == 0 or A.shape[0] != A.shape[1]:
        raise ValueError("eigvalsh: non-empty square matrix required")
    n = A.shape[0]
    w = np.zeros(n)
    _check(lib.qgdevs_eigvalsh(n, _ptr(A.view(np.float64)), _ptr(w)), lib)
    return w


def _scalar_4x4(fname: str, rho) -> float:
    lib = _get()
    rho = _c128(rho)
    if rho.shape != (4, 4):
        raise ValueError("two-qubit (4×4) density matrix required")
    out = np.zeros(1)
    _check(getattr(lib, fname)(_ptr(rho.view(np.float64)), _ptr(out)), lib)
    return float(out[0])


def negativity(rho) -> float:
    return _scalar_4x4("qgdevs_negativity", rho)


def concurrence(rho) -> float:
    return _scalar_4x4("qgdevs_concurrence", rho)


def cpk_witness_best_sign(rho) -> float:
    return _scalar_4x4("qgdevs_cpk_witness_best_sign", rho)


def purity(rho) -> float:
    lib = _get()
    rho = _c128(rho)
    if rho.ndim != 2 or rho.shape[0] != rho.shape[1] or rho.shape[0] == 0:
        raise ValueError("purity: non-empty square matrix required")  # the kernel reads n×n entries
    out = np.zeros(1)
    _check(lib.qgdevs_purity(rho.shape[0], _ptr(rho.view(np.float64)), _ptr(out)), lib)
    return float(out[0])


# ----------------------------------------------------------------------------- Lindblad dynamics
def _lindblad_args(rho0, H, Ls):
    rho0, H = _c128(rho0), _c128(H)
    d = H.shape[0]
    if H.shape != (d, d) or rho0.shape != (d, d):
        raise ValueError("rho0 and H must be d×d")
    Ls = list(Ls or [])
    Lstack = _c128(np.array(Ls).reshape(len(Ls), d, d)) if Ls else np.zeros((1, d, d), complex)
    return d, rho0, H, len(Ls), Lstack


def lindblad_dopri(rho0, H, Ls, times, rtol: float = 1e-10, atol: float = 1e-12, max_steps: int = 10_000_000,
                   return_stats: bool = False):
    """Adaptive Dormand–Prince 5(4) solution of dρ/dt = -i[H,ρ] + Σ(LρL† - ½{L†L,ρ}) (H in rad/s).

    rho0 is the state at times[0]; returns an array (len(times), d, d).
    """
    lib = _get()
    d, rho0, H, nL, Lstack = _lindblad_args(rho0, H, Ls)
    times = _f64(times).ravel()
    out = np.zeros((len(times), d, d), complex)
    stats = (ctypes.c_long * 3)()
    _check(lib.qgdevs_lindblad_dopri(d, _ptr(rho0.view(np.float64)), _ptr(H.view(np.float64)), nL,
                                     _ptr(Lstack.view(np.float64)), len(times), _ptr(times), float(rtol),
                                     float(atol), int(max_steps), _ptr(out.view(np.float64)), stats), lib)
    if return_stats:
        return out, {"accepted": stats[0], "rejected": stats[1], "nfev": stats[2]}
    return out


def lindblad_rk4(rho0, H, Ls, t_final: float, nsteps: int) -> np.ndarray:
    """Fixed-step classical RK4 from t = 0 to t_final (mirrors quantum.evolve_lindblad_rk4_fixed)."""
    lib = _get()
    d, rho0, H, nL, Lstack = _lindblad_args(rho0, H, Ls)
    out = np.zeros((d, d), complex)
    _check(lib.qgdevs_lindblad_rk4(d, _ptr(rho0.view(np.float64)), _ptr(H.view(np.float64)), nL,
                                   _ptr(Lstack.view(np.float64)), float(t_final), int(nsteps),
                                   _ptr(out.view(np.float64))), lib)
    return out


# ----------------------------------------------------------------------------- BMV
_LABELS = ["LL", "LR", "RL", "RR"]


def bmv_point(design, finite_size: bool = True) -> dict:
    """Point-mass BMV prediction for a bmv.BMVDesign (or dict with the same fields).

    finite_size=True raises NativeError for overlapping spheres (where point masses are not exact).
    """
    lib = _get()
    g = design if isinstance(design, dict) else design.as_dict()
    p = _f64([g["mass_A"], g["mass_B"], g["density"], g["separation"], g["dx_A"], g["dx_B"], g["angle_deg"],
              g["time"], g["gamma_A"], g["gamma_B"]])
    quads, scal, rho = np.zeros(12), np.zeros(5), np.zeros((4, 4), complex)
    _check(lib.qgdevs_bmv_point(_ptr(p), GEOMETRIES[g["geometry"]], int(finite_size), _ptr(quads), _ptr(scal),
                                _ptr(rho.view(np.float64))), lib)
    return {"branch_distances_m": dict(zip(_LABELS, quads[0:4].tolist())),
            "energies_J": dict(zip(_LABELS, quads[4:8].tolist())),
            "phases_rad": dict(zip(_LABELS, quads[8:12].tolist())),
            "delta_phi": float(scal[0]), "negativity": float(scal[1]), "concurrence": float(scal[2]),
            "witness_cpk_local_corrected": float(scal[3]), "purity": float(scal[4]), "rho": rho}


def bmv_sweep(mass, separation, dx, time, gamma, geometry: str = "parallel", angle_deg: float = 90.0,
              density: float = 3510.0, finite_size: bool = True, nthreads: int = 0) -> dict[str, np.ndarray]:
    """OpenMP Cartesian sweep with m_A = m_B = mass, dx_A = dx_B = dx, Γ_A = Γ_B = gamma.

    Returns arrays of shape (len(mass), len(separation), len(dx), len(time), len(gamma)) for
    delta_phi, negativity, concurrence, witness (sign-optimised CPK after local Z correction) and
    purity. With finite_size, designs whose spheres overlap are NaN (point masses not exact there).
    """
    lib = _get()
    axes = [np.atleast_1d(_f64(a)).ravel() for a in (mass, separation, dx, time, gamma)]
    shape = tuple(len(a) for a in axes)
    outs = {k: np.zeros(shape) for k in ("delta_phi", "negativity", "concurrence", "witness", "purity")}
    args = []
    for a in axes:
        args += [len(a), _ptr(a)]
    _check(lib.qgdevs_bmv_sweep(*args, GEOMETRIES[geometry], float(angle_deg), float(density), int(finite_size),
                                int(nthreads), *[_ptr(outs[k]) for k in outs]), lib)
    return outs


# ----------------------------------------------------------------------------- N-body
def nbody_verlet(pos0, vel0, masses, dt: float, nsteps: int, save_every: int = 1):
    """Velocity-Verlet integration; returns (ts, traj_p, traj_v) like gravity.nbody_verlet."""
    lib = _get()
    pos0, vel0, masses = _f64(pos0), _f64(vel0), _f64(masses).ravel()
    if pos0.ndim != 2:
        raise ValueError("pos0 must be (n, dim)")
    n, dim = pos0.shape
    if vel0.shape != (n, dim) or masses.shape != (n,):
        raise ValueError("pos0/vel0 must be (n, dim) and masses (n,)")
    if int(save_every) <= 0 or int(nsteps) < 0:
        raise ValueError("save_every must be positive and nsteps non-negative")
    nsave = nsteps // save_every + 1
    t, P, V = np.zeros(nsave), np.zeros((nsave, n, dim)), np.zeros((nsave, n, dim))
    _check(lib.qgdevs_nbody_verlet(n, dim, _ptr(pos0), _ptr(vel0), _ptr(masses), float(dt), int(nsteps),
                                   int(save_every), _ptr(t), _ptr(P), _ptr(V)), lib)
    return t, P, V


def nbody_energy(pos, vel, masses) -> float:
    lib = _get()
    pos, vel, masses = _f64(pos), _f64(vel), _f64(masses).ravel()
    if pos.ndim != 2 or vel.shape != pos.shape or masses.shape != (pos.shape[0],):
        raise ValueError("pos/vel must be (n, dim) and masses (n,)")  # the kernel reads n·dim entries of each
    out = np.zeros(1)
    _check(lib.qgdevs_nbody_energy(pos.shape[0], pos.shape[1], _ptr(pos), _ptr(vel), _ptr(masses), _ptr(out)), lib)
    return float(out[0])
