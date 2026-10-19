"""Backups and restore for the persistent state (jobs, catalogue, ledger, vault, stored data, results).

A snapshot is a .tar.gz containing consistent SQLite copies (online backup API) plus the append-only
ledger and content-addressed files, with a SHA-256 manifest. Snapshots are kept locally and, when
QGDEVS_BACKUP_S3_URL is configured (any S3-compatible store: AWS S3, Cloudflare R2, Backblaze B2, MinIO),
uploaded off-site so that recovery never depends on a single machine or on GitHub.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sqlite3
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .jobs import paths


def snapshot(out_dir: Path | None = None) -> Path:
    """Write a .tar.gz snapshot of the persistent state.

    Every member is read into memory once and the manifest hash is computed from exactly those bytes, so a
    file that changes while the snapshot runs (the ledger is appended by other processes) can never yield an
    archive whose manifest disagrees with its content. The ledger is copied under its append lock.
    """
    from .evidence import Ledger
    p = paths()
    out_dir = Path(out_dir or p["home"] / "backups")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = out_dir / f"qgdevs-{stamp}.tar.gz"
    hashes: dict[str, str] = {}
    tmp = target.with_suffix(".partial")
    with tarfile.open(tmp, "w:gz") as tar, tempfile.TemporaryDirectory() as td:

        def add(arc: str, data: bytes) -> None:  # hash and archive the very same bytes, one file at a time
            hashes[arc] = hashlib.sha256(data).hexdigest()
            info = tarfile.TarInfo(arc)
            info.size = len(data)
            info.mode = 0o640
            tar.addfile(info, io.BytesIO(data))

        for key in ("jobs", "catalogue"):
            if p[key].exists():
                dst = Path(td) / p[key].name
                src = sqlite3.connect(p[key])
                dcon = sqlite3.connect(dst)
                src.backup(dcon)
                dcon.close(); src.close()
                add(p[key].name, dst.read_bytes())
        if p["ledger"].exists():
            add("ledger.jsonl", Ledger(p["ledger"]).snapshot_bytes())
        for key in ("vault", "store", "results"):
            for f in sorted(p[key].rglob("*")):
                if f.is_file() and not f.name.endswith(".tmp"):
                    add(f"{key}/{f.relative_to(p[key]).as_posix()}", f.read_bytes())
        data = json.dumps({"created_utc": stamp, "files": hashes}, indent=1).encode()
        info = tarfile.TarInfo("MANIFEST.json")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    tmp.replace(target)  # never leave a truncated archive under the final name
    keep = max(1, int(os.environ.get("QGDEVS_BACKUP_KEEP", "14")))
    for old in sorted(out_dir.glob("qgdevs-*.tar.gz"))[:-keep]:
        old.unlink()
    return target


def upload(archive: Path) -> dict:
    url = os.environ.get("QGDEVS_BACKUP_S3_URL")  # e.g. s3://bucket/prefix
    if not url:
        return {"uploaded": False, "reason": "QGDEVS_BACKUP_S3_URL not configured"}
    if not url.startswith("s3://") or len(url) <= 5:
        return {"uploaded": False, "reason": "QGDEVS_BACKUP_S3_URL must look like s3://bucket[/prefix]"}
    import boto3
    bucket, _, prefix = url[5:].partition("/")
    s3 = boto3.client("s3", endpoint_url=os.environ.get("QGDEVS_BACKUP_S3_ENDPOINT") or None)
    key = f"{prefix.rstrip('/')}/{archive.name}".lstrip("/")
    s3.upload_file(str(archive), bucket, key)
    return {"uploaded": True, "bucket": bucket, "key": key}


def verify(archive: Path) -> dict:
    """Check every manifest entry against the archive, and that the archive holds nothing unlisted."""
    with tarfile.open(archive, "r:gz") as tar:
        manifest = json.loads(tar.extractfile("MANIFEST.json").read())
        names = {m.name for m in tar.getmembers() if m.isfile()} - {"MANIFEST.json"}
        bad, missing = [], []
        for arc, h in manifest["files"].items():
            try:
                data = tar.extractfile(arc).read()
            except KeyError:
                missing.append(arc)
                continue
            if hashlib.sha256(data).hexdigest() != h:
                bad.append(arc)
        unlisted = sorted(names - set(manifest["files"]))
    return {"valid": not (bad or missing or unlisted), "corrupt": bad, "missing": missing, "unlisted": unlisted,
            "n_files": len(manifest["files"])}


def restore(archive: Path, target_home: Path) -> dict:
    """Restore a verified snapshot into target_home. Stop the API and workers first.

    Only members listed (and verified) in the manifest are extracted. Stale SQLite WAL/SHM side files of the
    databases being replaced are removed: SQLite would otherwise replay the old write-ahead log onto the
    restored database.
    """
    v = verify(archive)
    if not v["valid"]:
        raise RuntimeError(f"backup failed integrity check: {v}")
    target_home.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        listed = set(json.loads(tar.extractfile("MANIFEST.json").read())["files"])
        for m in tar.getmembers():
            if m.name not in listed or m.name.startswith("/") or ".." in Path(m.name).parts:
                continue
            if m.name.endswith(".db"):
                for side in ("-wal", "-shm", "-journal"):
                    (target_home / (m.name + side)).unlink(missing_ok=True)
            tar.extract(m, target_home, filter="data")
    from .evidence import Ledger
    led = target_home / "ledger.jsonl"
    return {**v, "ledger_chain": Ledger(led).verify() if led.exists() else None, "restored_to": str(target_home)}


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2 and sys.argv[1] == "restore":
        print(json.dumps(restore(Path(sys.argv[2]), Path(sys.argv[3] if len(sys.argv) > 3 else paths()["home"]))))
    else:
        a = snapshot()
        print(json.dumps({"archive": str(a), **verify(a), **upload(a)}))
