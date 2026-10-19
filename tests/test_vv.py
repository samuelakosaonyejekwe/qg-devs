"""Runs every registered verification benchmark (qgdevs.vv) as an individual test."""
import pytest

from qgdevs import vv

IDS = [b.id for b in vv.REGISTRY]


@pytest.mark.parametrize("bid", IDS)
def test_benchmark(bid):
    b = next(x for x in vv.REGISTRY if x.id == bid)
    if b.slow:
        pytest.importorskip("numpy")
    r = vv.run([bid])["results"][0]
    assert r["error"] is None, r["error"]
    assert r["passed"], f"{bid}: value {r['value']} vs tolerance {r['tolerance']} ({r['justification']})"
