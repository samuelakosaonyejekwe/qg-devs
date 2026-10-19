#!/usr/bin/env bash
# QG-DEVS formal verification gate.
#   1. Rejects any `sorry`, `admit` or `axiom` token in the QGDEVS sources.
#   2. Runs `lake build` (must succeed).
#   3. Prints `#print axioms` for every headline theorem and fails unless each depends only on
#      the standard axioms propext, Classical.choice, Quot.sound.
set -euo pipefail
cd "$(dirname "$0")"

echo "== [1/3] scanning QGDEVS sources for sorry/admit/axiom"
if grep -nwE 'sorry|admit|axiom' QGDEVS.lean QGDEVS/*.lean; then
  echo "FAIL: forbidden token found in QGDEVS sources" >&2
  exit 1
fi
echo "ok: no sorry/admit/axiom tokens"

echo "== [2/3] lake build"
start=$(date +%s)
lake build
echo "ok: lake build succeeded in $(( $(date +%s) - start ))s"

echo "== [3/3] axiom audit"
out=$(lake env lean scripts/Axioms.lean 2>&1)
echo "$out"
n_total=$(grep -c "depends on axioms" <<<"$out" || true)
n_expected=$(grep -c '^#print axioms' scripts/Axioms.lean)
bad=$(grep "depends on axioms" <<<"$out" | grep -v "depends on axioms: \[propext, Classical.choice, Quot.sound\]$" || true)
if grep -q "sorryAx" <<<"$out" || [ -n "$bad" ] || [ "$n_total" -ne "$n_expected" ]; then
  echo "FAIL: non-standard axioms or missing theorems in audit ($n_total/$n_expected reported)" >&2
  [ -n "$bad" ] && echo "$bad" >&2
  exit 1
fi
echo "ok: $n_total/$n_expected theorems depend only on [propext, Classical.choice, Quot.sound]"
echo "ALL CHECKS PASSED"
