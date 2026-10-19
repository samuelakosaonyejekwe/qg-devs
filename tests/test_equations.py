"""Every displayed equation must typeset under KaTeX strict mode (uses web/node_modules/katex when installed)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from qgdevs.equations import MODEL_TEX, PROTOCOL_TEX, SUITE_TEX
from qgdevs.models import HYPOTHESES

ROOT = Path(__file__).resolve().parent.parent
KATEX = ROOT / "web" / "node_modules" / "katex"


def all_tex():
    return ([e["tex"] for v in SUITE_TEX.values() for e in v]
            + [t for m in MODEL_TEX.values() for lst in m.values() for t in lst] + list(PROTOCOL_TEX.values()))


def test_every_hypothesis_has_latex():
    for hid in HYPOTHESES:
        assert MODEL_TEX[hid]["dynamics"], hid


@pytest.mark.skipif(not (KATEX.exists() and shutil.which("node")), reason="KaTeX not installed in web/node_modules")
def test_katex_strict_render(tmp_path):
    f = tmp_path / "eqs.json"
    f.write_text(json.dumps(all_tex()))
    js = (f"const k=require({json.dumps(str(KATEX))});const L=require({json.dumps(str(f))});let bad=[];"
          "for(const t of L){try{k.renderToString(t,{displayMode:true,throwOnError:true,strict:'error'})}"
          "catch(e){bad.push(t+' :: '+e.message)}}console.log(JSON.stringify(bad))")
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, timeout=60)
    assert json.loads(out.stdout) == []
