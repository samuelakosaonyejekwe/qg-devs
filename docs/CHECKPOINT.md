# Development checkpoint and resume instructions

_Last updated: 2026-10-19 21:10. If a session is interrupted, resume from "IN PROGRESS" below._

**Resume protocol after an interruption.** Background agents die with the session; their work survives on disk.
1. `cd /home/akosa/grqg && git status --short web/`. The web agent's UNCOMMITTED work (Tex/Equations components, Reset semantics, player and visibility fixes, hardening tests) lives in the working tree. Never `git checkout`/`reset`/`clean` it.
2. Continue the remaining web items from the list below on top of that tree, then run `cd web && npm run typecheck && npm test && npm run build` and the Playwright scripts in `web/scripts/` (Playwright is in the session scratchpad; reinstall with `npm i playwright` in a scratch directory if needed).
3. Release as described in item 3 (Release) and update this file.

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

**0.2.2 is LIVE** at https://63-186-135-183.sslip.io. Additions since:
- `GET /api/auth/whoami`;
- CORS restricted to https://samuelakosaonyejekwe.github.io and the server origin.

**PUBLIC URL (LIVE): https://samuelakosaonyejekwe.github.io/qg-devs/** — GitHub Pages, deployed by .github/workflows/pages.yml on every push touching web/. Version 0.2.3 is live on both the Pages site and the API server.

Web agent round (in progress):
- (1) Suite 18 "Signing as <identity>", no reviewer box, "acting as" on all evidence forms;
- (2) an anchors panel with download and verify buttons;
- (3) the Suite 8 Reset check waits for its default computation (data-state="ready");
- (4) VITE_BASE support for GitHub Pages: router, service worker, manifest, KaTeX fonts, workers, 404.html deep links, meta CSP with connect-src to the API.

Then:
- verify;
- commit web + pages.yml and push; watch the Actions run (`gh run watch`);
- check the live github.io URL in a headless browser;
- bump to 0.2.3 with release notes;
- redeploy the server.

## Rules

- No AI or bot attribution in commits or files.
- Scan for secrets before every push; the repository is public.
- Never claim that synthetic or computational results are physical evidence.
