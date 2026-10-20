"""External anchoring of the evidence ledger (makes deletion of the newest entries detectable).

A hash chain detects edits, but anyone controlling the server could silently drop the newest entries. An
*anchor* commits to (index, entry_hash) of the ledger head at a point in time and is published OUTSIDE the
server:

* to the off-site object store used for backups (S3-compatible bucket, separate credentials and operator);
* to public OpenTimestamps calendar servers, which aggregate digests into Bitcoin transactions, giving an
  independent, publicly verifiable timestamp (Todd, "OpenTimestamps", https://opentimestamps.org).

Verification checks the current ledger against every known anchor (local copy, the bucket and any anchor a third
party supplies): each anchored entry must still exist with the same hash. A ledger shorter than an anchor, or with a
different hash at an anchored index, has been truncated or rewritten.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .evidence import Ledger, canonical

CALENDARS = ("https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org",
             "https://a.pool.eternitywall.com")


def _anchor_digest(anchor: dict) -> bytes:
    return hashlib.sha256(canonical({k: anchor[k] for k in ("ledger_index", "entry_hash", "created_utc")})).digest()


def make_anchor(ledger: Ledger) -> dict | None:
    entries = ledger.entries()
    if not entries:
        return None
    head = entries[-1]
    a = {"ledger_index": head["index"], "entry_hash": head["entry_hash"],
         "created_utc": datetime.now(timezone.utc).isoformat()}
    a["anchor_sha256"] = _anchor_digest(a).hex()
    return a


def _local_dir(ledger: Ledger) -> Path:
    d = ledger.path.parent / "anchors"
    d.mkdir(parents=True, exist_ok=True)
    return d


def local_anchors(ledger: Ledger) -> list[dict]:
    f = _local_dir(ledger) / "anchors.jsonl"
    if not f.exists():
        return []
    return [json.loads(line) for line in f.read_text().splitlines() if line.strip()]


def submit_opentimestamps(digest: bytes, client=None, timeout: float = 20.0) -> dict[str, bytes]:
    """POST the 32-byte digest to each calendar; returns {calendar: pending timestamp proof bytes}."""
    import httpx
    own = client is None
    client = client or httpx.Client(timeout=timeout)
    proofs = {}
    try:
        for cal in CALENDARS:
            try:
                r = client.post(f"{cal}/digest", content=digest,
                                headers={"Content-Type": "application/x-www-form-urlencoded",
                                         "Accept": "application/vnd.opentimestamps.v1"})
                if r.status_code == 200 and r.content:
                    proofs[cal] = r.content
            except httpx.HTTPError:
                continue
    finally:
        if own:
            client.close()
    return proofs


def _s3():
    url = os.environ.get("QGDEVS_BACKUP_S3_URL", "")
    if not url.startswith("s3://"):
        return None, None, None
    import boto3
    bucket, _, prefix = url[5:].partition("/")
    return boto3.client("s3", endpoint_url=os.environ.get("QGDEVS_BACKUP_S3_ENDPOINT") or None), bucket, \
        f"{prefix.rstrip('/')}/anchors".lstrip("/")


def publish(ledger: Ledger, use_network: bool = True) -> dict:
    """Create and publish an anchor if the head changed since the last one."""
    prev = local_anchors(ledger)
    a = make_anchor(ledger)
    if a is None:
        return {"anchored": False, "reason": "empty ledger"}
    if prev and prev[-1]["entry_hash"] == a["entry_hash"]:
        return {"anchored": False, "reason": "head unchanged since last anchor", "last": prev[-1]}
    d = _local_dir(ledger)
    a["published"] = {}
    if use_network:
        proofs = submit_opentimestamps(bytes.fromhex(a["anchor_sha256"]))
        for cal, proof in proofs.items():
            name = f"{a['ledger_index']:08d}-{a['anchor_sha256'][:16]}-{cal.split('//')[1].split('.')[1]}.ots"
            (d / name).write_bytes(proof)
            a["published"].setdefault("opentimestamps", []).append({"calendar": cal, "proof_file": name})
        s3, bucket, prefix = _s3()
        if s3 is not None:
            key = f"{prefix}/{a['ledger_index']:08d}-{a['anchor_sha256'][:16]}.json"
            s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(a).encode(), ContentType="application/json")
            a["published"]["object_store"] = {"bucket": bucket, "key": key}
    with (d / "anchors.jsonl").open("a") as f:
        f.write(json.dumps(a) + "\n")
    return {"anchored": True, "anchor": a}


def remote_anchors() -> list[dict]:
    s3, bucket, prefix = _s3()
    if s3 is None:
        return []
    out = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix + "/"):
        for obj in page.get("Contents", []):
            out.append(json.loads(s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read()))
    return out


def verify(ledger: Ledger, anchors: list[dict]) -> dict:
    """Check the ledger against anchors: anchored entries must still exist with identical hashes."""
    entries = ledger.entries()
    chain = ledger.verify()
    problems = []
    for a in anchors:
        try:
            if not isinstance(a.get("ledger_index"), int) or a["ledger_index"] < 0 or not isinstance(a.get("entry_hash"), str):
                raise KeyError
            ok = _anchor_digest(a).hex() == a.get("anchor_sha256")
        except (KeyError, TypeError, AttributeError):
            problems.append({"anchor": str(a)[:80], "problem": "malformed anchor record"})
            continue
        if not ok:
            problems.append({"anchor": a.get("anchor_sha256"), "problem": "anchor record itself altered"})
            continue
        i = a["ledger_index"]
        if i >= len(entries):
            problems.append({"anchor": a["anchor_sha256"], "problem": f"ledger truncated: anchored entry {i} missing "
                                                                     f"(ledger has {len(entries)} entries)"})
        elif entries[i]["entry_hash"] != a["entry_hash"]:
            problems.append({"anchor": a["anchor_sha256"], "problem": f"entry {i} differs from its anchored hash"})
    return {"chain_valid": chain["valid"], "anchors_checked": len(anchors), "anchor_problems": problems,
            "valid": chain["valid"] and not problems,
            "latest_anchor": max((a for a in anchors if isinstance(a.get("ledger_index"), int)),
                                 key=lambda a: a["ledger_index"], default=None)}
