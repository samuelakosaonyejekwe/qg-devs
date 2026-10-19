"""Optional MATLAB / GNU Octave bridge for independent cross-checks (never required by the platform).

Backends, in order: the MATLAB Engine API for Python (requires a licensed MATLAB installation), then
`octave-cli` via subprocess. Functions live in the repository's matlab/ directory.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

MDIR = Path(__file__).resolve().parent.parent / "matlab"


def backend() -> str | None:
    try:
        import matlab.engine  # noqa: F401
        return "matlab"
    except Exception:
        pass
    return "octave" if shutil.which("octave-cli") or shutil.which("octave") else None


def available() -> dict:
    b = backend()
    return {"backend": b, "available": b is not None,
            "note": None if b else "no licensed MATLAB engine or GNU Octave found; Python/C++ implementations are used"}


def bmv_entangling_phase(mA: float, mB: float, d: float, dx: float, t: float, geometry: str = "parallel") -> float:
    b = backend()
    if b == "matlab":
        import matlab.engine
        eng = matlab.engine.start_matlab()
        try:
            eng.addpath(str(MDIR))
            return float(eng.bmv_entangling_phase(mA, mB, d, dx, t, geometry, nargout=1))
        finally:
            eng.quit()
    if b == "octave":
        exe = shutil.which("octave-cli") or shutil.which("octave")
        code = (f"addpath('{MDIR}'); dphi = bmv_entangling_phase({mA!r}, {mB!r}, {d!r}, {dx!r}, {t!r}, '{geometry}');"
                " printf('%.17g\\n', dphi);")
        out = subprocess.run([exe, "--no-gui", "--quiet", "--eval", code], capture_output=True, text=True, timeout=120)
        out.check_returncode()
        return float(out.stdout.strip().splitlines()[-1])
    raise RuntimeError(json.dumps(available()))
