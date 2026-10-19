"""Command-line interface.

  python -m qgdevs.cli predict  [config.json]   flagship BMV prediction (all hypotheses) as JSON
  python -m qgdevs.cli reproduce config.json    re-run a reproduction package's configuration
  python -m qgdevs.cli vv [--slow]              run the verification registry
  python -m qgdevs.cli dossier [config.json]    experimental dossier
  python -m qgdevs.cli worker                   start the job worker + scheduler
  python -m qgdevs.cli serve [--port 8000]      start the API (and web app if built)
"""
from __future__ import annotations

import argparse
import json
import sys

from .api import _dumps


def _scenario(path: str | None):
    from .bmv import BMVDesign
    from .design import Environment
    if path:
        with open(path) as f:
            cfg = json.load(f)
    else:
        cfg = {}
    return BMVDesign.from_dict(cfg.get("design", {})), Environment(**cfg.get("environment", {}))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="qgdevs")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("predict", "reproduce", "dossier"):
        s = sub.add_parser(name)
        s.add_argument("config", nargs="?" if name != "reproduce" else None)
    s = sub.add_parser("vv")
    s.add_argument("--slow", action="store_true")
    sub.add_parser("worker")
    s = sub.add_parser("serve")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--host", default="0.0.0.0")
    a = ap.parse_args(argv)

    if a.cmd in ("predict", "reproduce"):
        from .design import full_prediction
        d, env = _scenario(a.config)
        # identical to POST /api/bmv/predict (default n_times), so a reproduction package re-run is comparable
        print(_dumps(full_prediction(d, env)))
    elif a.cmd == "dossier":
        from .lab import generate_dossier
        d, env = _scenario(a.config)
        print(_dumps(generate_dossier(d, env)))
    elif a.cmd == "vv":
        from .vv import run
        r = run(include_slow=a.slow)
        print(_dumps(r))
        return 0 if r["summary"]["failed"] == 0 else 1
    elif a.cmd == "worker":
        from .jobs import worker_loop
        worker_loop()
    elif a.cmd == "serve":
        import uvicorn
        uvicorn.run("qgdevs.api:app", host=a.host, port=a.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
