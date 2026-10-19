# Development checkpoint and resume instructions

_Last updated: 2026-10-19 (session in progress). If a session is interrupted, resume from "IN PROGRESS" below._

## Live system

- App: https://63-186-135-183.sslip.io. The API reference is at `/api/docs`.
- Server: AWS Lightsail instance `qg-devs` in eu-central-1, static IP 63.186.135.183, running Caddy (TLS) and Docker.
- Deploy:
  - `ssh -i ~/.ssh/qgdevs-lightsail.pem ubuntu@63.186.135.183`
  - `cd /opt/qgdevs/src && git pull && sudo docker build -t qgdevs:latest .`
  - `sudo docker rm -f qgdevs && sudo docker run -d --name qgdevs --restart unless-stopped --env-file /opt/qgdevs/server.env -p 127.0.0.1:8000:8000 -v qgdevs-data:/data qgdevs:latest`
- Secrets live only on the developer machine (`~/.config/qgdevs/server.env`) and on the server (`/opt/qgdevs/server.env`).

## DONE (verified)

- 18 suites, 7 hypotheses including Aziz–Howl, nuisance-robust discrimination, design optimisation, discovery engine, dossiers, evidence ledger, thought lab, and the optional language model.
- pytest: 102 passed, 2 skipped (MATLAB/Octave not installed). V&V: 33/33 benchmarks.
- C++ kernel: 18 comparison tests. Lean 4: 43 theorems proved, 0 open (`lean/check.sh`).
- Web app v1 deployed with a hot-fix: sidebar and Dashboard suites in strict 1–18 order (built from commit 1d8b29a + nav.ts patch; served from /opt/qgdevs/web/dist mounted into the container). Web tests: 129 passed. The full v0.2.0 web release must keep the 1–18 order.

## IN PROGRESS (resume here)

- **0.2.0 is LIVE** (commit 03daa70, plus start.sh forwarded-IP fix). It includes Reset, update dialogs, the 1–18 order and HD 2-D/3-D views on all suites; public computation jobs (rate-limited); evidence writes need a token. Verified live: 43 Lean theorems, 8 hypotheses, `/api/equations`.
- **Next (web agent):**
  - (1) KaTeX/LaTeX rendering of every equation, using `/api/equations` and the models' `tex` fields; and add katex to `web/package.json` so `tests/test_equations.py` runs;
  - (2) friendly 401/403/429/503 UX, plus an audit of every page for raw errors and layout issues.
  - (3) URGENT 3-D legibility fixes: the density-matrix city plot's bars are near-black (cyclic colour map plus dim lighting), the legend is clipped, the camera framing clips bars and labels, and the axis title is not typeset;
  - (4) a visible Play/Pause control and auto-play on every animated view, plus "Play all" for synchronised comparisons;
  - (5) a visual QA pass of all views in both themes at 1440 px and 360 px.
  - (6) Player bug: Play at the last sample does nothing (must rewind; loop on by default; start at t=0). Invisible dynamics, e.g. S06 vacuum with g~1e-10: use visible physical defaults, resolve motion in time (≥24 samples per period), show a "below display resolution" notice and an opt-in labelled MAGNIFIED deviation view; Playwright frame-diff checks.
  - (7) S07: environmental-only default is live (commit 0b52566). UI work remaining: opt-in collapse toggles, time-window selector, trail, synced 2-D plot, legend colours.
  - (8) RESET = exact first-visit state per route: defaults, all outputs and caches cleared, auto-run pages show their original default result at t=0. Playwright snapshot-equality test on every route.
  - (9) Audits running: backend (separate agent, qgdevs/cpp/deploy) and a web hidden-issues audit (web agent). Server hardening DONE: HSTS, frame, permissions and COOP headers, CSP report-only (`deploy/Caddyfile`); root SSH disabled; off-site backups verified in the S3 bucket. TODO: enforce CSP after the web app is verified clean under it.
- **Then:** verify (pytest, `cd web && npm run typecheck && npm test && npm run build`), add a 0.2.1 entry to `qgdevs/release_notes.json`, bump the version, commit with an explicit file list, and deploy. The server build uses the full Dockerfile: `sudo docker build -t qgdevs:<ver> .` then `run` (see Live system).

## Rules

- No AI or bot attribution in commits or files.
- Scan for secrets before every push; the repository is public.
- Never claim that synthetic or computational results are physical evidence.
