# Deployment, offline operation and disaster recovery

## Topology (independent of any developer computer and of GitHub at runtime)

| Layer | Primary | Redundancy |
|---|---|---|
| API + web app + worker/scheduler | Fly.io (`fly.toml`): one always-on machine, persistent volume `/data`, automatic restart, `/api/health` checks | Render (`render.yaml`), or any Docker host (`docker-compose.yml`) — same image |
| Static web app (PWA) | served by the API host | mirrored to Cloudflare Pages (`deploy.yml` → `static-mirror`, or `deploy/deploy-local.sh cloudflare`); the mirror calls the API via `VITE_API_BASE` and falls back to its offline engine |
| Container image | GHCR (`ghcr.io/samuelakosaonyejekwe/qg-devs`) | rebuilt from any checkout: `flyctl deploy --remote-only` builds on Fly's builders without GitHub |
| Data | `/data` volume | daily snapshots (`qgdevs/backup.py`, scheduled job `daily-backup`) uploaded to any S3-compatible bucket (R2/B2/S3) via `QGDEVS_BACKUP_S3_URL` |
| Source | GitHub | any clone; `deploy/deploy-local.sh` deploys without GitHub |

The worker's scheduler (`qgdevs/jobs.py: SCHEDULE`) runs server-side:
- literature ingestion daily (arXiv, Crossref, Zenodo);
- the GWOSC event catalogue weekly;
- NIST CODATA constants monthly;
- the verification registry nightly;
- a discovery cycle weekly;
- backups daily.

Sources that publish periodically are recorded with their fetch timestamps and are never presented as real-time
streams.

## Going live (requires your accounts; nothing has been deployed yet)

1. **Fly.io**: run `flyctl auth login`, `flyctl launch --no-deploy --copy-config`,
   `flyctl volumes create qgdevs_data --size 5`, and `flyctl secrets set QGDEVS_API_TOKENS=<token>:admin`. Then run
   `flyctl deploy`. Optionally, run `flyctl secrets set ANTHROPIC_API_KEY=… QGDEVS_BACKUP_S3_URL=s3://bucket/qgdevs …`.
   The images set `QGDEVS_REQUIRE_TOKENS=1`: if `QGDEVS_API_TOKENS` is missing, every visitor is treated as
   public (read and compute only) rather than granted write access. Only a local run without that variable is in
   development mode (every request acts as a researcher).
2. **GitHub Actions CD**:
   - Add secret `FLY_API_TOKEN` and variable `DEPLOY_FLY=true`.
   - For the static mirror, add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and variables
     `DEPLOY_CLOUDFLARE=true` and `API_BASE_URL=https://qg-devs.fly.dev`.
3. **Secondary host** (optional): connect the repository on Render; it reads `render.yaml`.

## Offline modes (honest limits)

| Works offline (after first online visit / install) | Needs a connection |
|---|---|
| App shell, help, documentation, all navigation | fresh data from external repositories |
| Flagship BMV calculations, decoherence budget, Casimir, competing-model states via the local TypeScript engine (labelled COMPUTED LOCALLY) | long jobs (design optimisation, discrimination matrices, inference, discovery) |
| Previously viewed results (cached responses show "cached at …") | Lean proof checking, C++ kernel |
| Saved projects (IndexedDB); queued submissions synced when back online | language-model assistance (unless a local Ollama runs on the same device) |

Airplane mode never yields "fresh" data. The UI shows connectivity state and cache timestamps.

## Disaster recovery

| Scenario | Recovery |
|---|---|
| Machine crash | platform restarts it; running jobs are re-queued by heartbeat recovery (`JobStore.recover_stale`) |
| Volume loss | `python -m qgdevs.backup restore <snapshot.tar.gz> /data`. Restore verifies every file hash and the ledger hash chain before use |
| Host outage | deploy the same image to the secondary host and restore the latest off-site snapshot |
| GitHub outage | `deploy/deploy-local.sh fly` from any clone; the static mirror can be published with `deploy/deploy-local.sh cloudflare` |
| Tampering suspicion | `GET /api/evidence/ledger` reports chain verification; vault files are content-addressed and re-hashed on every read |

Restore drill: `tests/test_workflows.py::test_backup_restore_roundtrip` runs a snapshot → verify → restore → chain check
on every CI run.


## Identities, anchoring and retention

* **Tokens carry identities.** `QGDEVS_API_TOKENS="token:role:Full Name, token2:researcher:Dr B. Reviewer"`.
  Evidence writes (preregistrations, dataset ingestion, unblinding, sign-offs) record that name plus a 12-hex
  fingerprint of the token (never the token). Typed reviewer names are ignored.
* **G6/G7 policy.**
  - G6 passes only with a REAL blind-test dataset that was ingested under a preregistration and unblinded
    against it, plus an identity-verified G6 sign-off.
  - G7 additionally needs REAL replication data from a different identity, plus a G7 sign-off by someone who did
    not sign G6.
* **Ledger anchoring.**
  - Every hour (when the head changes) the head `(index, entry_hash)` is published to the backup bucket and to
    three public OpenTimestamps calendars (Bitcoin-anchored).
  - `GET /api/evidence/anchors` lists the anchors and verifies the ledger against them.
  - Third parties should archive the anchors and later `POST` them to `/api/evidence/verify-anchors`; truncation or
    rewriting is then detected.
* **Retention.**
  - Results and checkpoints of jobs finished more than `QGDEVS_RESULT_RETENTION_DAYS` (default 30) days ago are
    deleted daily, unless the evidence ledger references them.
  - Job records themselves are kept.
