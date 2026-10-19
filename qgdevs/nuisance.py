"""Nuisance-parameter type shared by the hypothesis registry and model modules."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Nuisance:
    name: str
    low: float
    high: float
    nominal: float
    unit: str
    description: str
