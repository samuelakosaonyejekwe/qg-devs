#!/bin/sh
# Process launcher. "all": API + worker/scheduler in one container (single-machine hosts);
# "api" / "worker": separate process groups (Fly.io, Kubernetes, compose).
set -eu
MODE="${1:-all}"
PORT="${PORT:-8000}"
case "$MODE" in
  api)    exec uvicorn qgdevs.api:app --host 0.0.0.0 --port "$PORT" --proxy-headers --workers "${WEB_CONCURRENCY:-2}" ;;
  worker) exec python -m qgdevs.jobs ;;
  all)
    python -m qgdevs.jobs &
    WORKER=$!
    trap 'kill $WORKER 2>/dev/null' INT TERM EXIT
    uvicorn qgdevs.api:app --host 0.0.0.0 --port "$PORT" --proxy-headers --workers "${WEB_CONCURRENCY:-2}" &
    API=$!
    # if either process dies, exit so the platform restarts the machine
    while kill -0 $WORKER 2>/dev/null && kill -0 $API 2>/dev/null; do sleep 5; done
    exit 1 ;;
  *) echo "usage: qgdevs-start all|api|worker" >&2; exit 2 ;;
esac
