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
- Web app v1 deployed. Web tests: 129 passed.

## IN PROGRESS (resume here)

1. **Web update** (`web/`), delegated to a web agent. Before deploying, check `git status web/` and run the web tests (`npm run typecheck && npm test && npm run build`). The update covers:
   - (a) a Reset control beside every Run (page or shared scenario; Settings: reset all);
   - (b) an update pop-up / "What's new" dialog driven by `GET /api/release` (`qgdevs/release_notes.json`, version 0.2.0);
   - (c) sidebar suites in strict order 1..18 under "Scientific suites";
   - (d) new 3-D dynamic views for S04 density-matrix city plot, S06, S07, S08, S10, S11, S13 and S14, plus conceptual views where appropriate;
   - (e) a high-fidelity rendering bar for all 2-D and 3-D animations: antialiasing, DPR, PBR lighting, CSS2D labels, Line2, 60 fps interpolation with the sample time shown, 4K/8K PNG and WebM export, fullscreen, context-loss handling, reduced motion, and synchronised 2-D/3-D toggles;
   - (f) 2× screenshots in light and dark into `docs/screenshots/`.

   Note: commit 5c0a292 accidentally included some intermediate web files; the finished update supersedes them.
2. **Science gaps — DONE (commit dd33170):** CSL-COLL hypothesis (8 hypotheses in total); patch-dipole, diamagnetic and NV spin–spin backgrounds with dossier limits (p ≤ 3.3e-29 C m, B ≤ 0.20 mT); Stern–Gerlach recombination visibility and gradient-precision requirement (≈5e-9 relative); pytest 107 passed.
   - Running: `tools/flagship_study.py` regenerating `docs/FLAGSHIP_RESULTS.md` with all 8 hypotheses. If it was interrupted, re-run it and commit `docs/FLAGSHIP_RESULTS.md` and `docs/flagship_results.json`. Then run `tools/gen_docs.py --slow` and commit `docs/`.
3. **Release 0.2.0:** run pytest, then `cd web && npm test && npm run build`, commit with an explicit file list (never `commit -a` while agents are editing), push, deploy (commands above), and verify live: `/`, `/api/health`, `/api/release`, `/api/lean/status` (43 proved).

## Rules

- No AI or bot attribution in commits or files.
- Scan for secrets before every push; the repository is public.
- Never claim that synthetic or computational results are physical evidence.
