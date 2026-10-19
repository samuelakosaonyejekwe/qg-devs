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


def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot(out_dir: Path | None = None) -> Path:
    p = paths()
    out_dir = Path(out_dir or p["home"] / "backups")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = out_dir / f"qgdevs-{stamp}.tar.gz"
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        files: list[tuple[Path, str]] = []
        for key in ("jobs", "catalogue"):
            if p[key].exists():
                dst = td / p[key].name
                src = sqlite3.connect(p[key])
                dcon = sqlite3.connect(dst)
                src.backup(dcon)
                dcon.close(); src.close()
                files.append((dst, p[key].name))
        if p["ledger"].exists():
            files.append((p["ledger"], "ledger.jsonl"))
        for key in ("vault", "store", "results"):
            for f in sorted(p[key].rglob("*")):
                if f.is_file():
                    files.append((f, f"{key}/{f.relative_to(p[key]).as_posix()}"))
        manifest = {"created_utc": stamp, "files": {arc: _sha(f) for f, arc in files}}
        with tarfile.open(target, "w:gz") as tar:
            for f, arc in files:
                tar.add(f, arcname=arc)
            data = json.dumps(manifest, indent=1).encode()
            info = tarfile.TarInfo("MANIFEST.json")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    keep = int(os.environ.get("QGDEVS_BACKUP_KEEP", "14"))
    for old in sorted(out_dir.glob("qgdevs-*.tar.gz"))[:-keep]:
        old.unlink()
    return target


def upload(archive: Path) -> dict:
    url = os.environ.get("QGDEVS_BACKUP_S3_URL")  # e.g. s3://bucket/prefix
    if not url:
        return {"uploaded": False, "reason": "QGDEVS_BACKUP_S3_URL not configured"}
    import boto3
    bucket, _, prefix = url[5:].partition("/")
    s3 = boto3.client("s3", endpoint_url=os.environ.get("QGDEVS_BACKUP_S3_ENDPOINT") or None)
    key = f"{prefix.rstrip('/')}/{archive.name}".lstrip("/")
    s3.upload_file(str(archive), bucket, key)
    return {"uploaded": True, "bucket": bucket, "key": key}


def verify(archive: Path) -> dict:
    with tarfile.open(archive, "r:gz") as tar:
        manifest = json.loads(tar.extractfile("MANIFEST.json").read())
        bad = []
        for arc, h in manifest["files"].items():
            data = tar.extractfile(arc).read()
            if hashlib.sha256(data).hexdigest() != h:
                bad.append(arc)
    return {"valid": not bad, "corrupt": bad, "n_files": len(manifest["files"])}


def restore(archive: Path, target_home: Path) -> dict:
    v = verify(archive)
    if not v["valid"]:
        raise RuntimeError(f"backup failed integrity check: {v['corrupt']}")
    target_home.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tar:
        for m in tar.getmembers():
            if m.name == "MANIFEST.json" or m.name.startswith("/") or ".." in Path(m.name).parts:
                continue
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
