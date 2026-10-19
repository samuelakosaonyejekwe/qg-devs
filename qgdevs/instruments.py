"""Suite 9, Environment B — physical instrument integration framework.

Adapters expose a uniform, audited interface to laboratory hardware. Safety rules (spec §19):
* every command requires an operator authorisation record (who, when, why) issued for that device;
* commands are validated against device-specific operating limits before dispatch;
* an emergency stop latches the device and refuses further commands until explicitly reset;
* every command, refusal and acquisition is appended to the evidence ledger;
* language models and automated jobs can never authorise commands.

No physical device is connected in this environment. `SimulatedInstrument` produces data labelled
SYNTHETIC; `FileReplayInstrument` replays instrument-native files supplied by a laboratory and labels them
REAL only when the operator attests their origin (the attestation is itself ledgered).
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

import numpy as np

from .evidence import Ledger, sha256_bytes


class SafetyError(RuntimeError):
    pass


@dataclass
class Limit:
    low: float
    high: float
    unit: str


@dataclass
class Authorisation:
    operator: str
    device_id: str
    purpose: str
    issued: float
    expires: float
    token: str = ""

    def valid(self, device_id: str) -> bool:
        return self.device_id == device_id and time.time() < self.expires


@dataclass
class InstrumentAdapter:
    device_id: str
    description: str
    limits: dict[str, Limit]
    ledger: Ledger
    connected: bool = False
    estop: bool = False
    state: dict = field(default_factory=dict)
    _issued: dict = field(default_factory=dict, repr=False)

    def authorise(self, operator: str, purpose: str, minutes: float = 60) -> Authorisation:
        if not operator or operator.strip().lower() in ("ai", "assistant", "language-model", "system", "job"):
            raise SafetyError("authorisation must be issued by a named human operator")
        if not 0 < minutes <= 24 * 60:
            raise SafetyError("authorisation lifetime must be between 0 and 24 h")
        a = Authorisation(operator, self.device_id, purpose, time.time(), time.time() + 60 * minutes,
                          secrets.token_hex(16))
        self._issued[a.token] = a
        self.ledger.append("instrument_authorisation", {"device_id": self.device_id, "operator": operator,
                                                        "purpose": purpose, "expires": a.expires}, operator)
        return a

    def _authorised(self, auth) -> bool:
        """Only authorisations issued (and ledgered) by this adapter count: a hand-built Authorisation object
        with a plausible operator name and expiry is refused."""
        return (isinstance(auth, Authorisation) and self._issued.get(auth.token) is auth
                and auth.valid(self.device_id))

    def command(self, auth: Authorisation, name: str, value: float) -> dict:
        if self.estop:
            self._log("refused", name, value, auth, "emergency stop latched")
            raise SafetyError("emergency stop latched")
        if not self._authorised(auth):
            self._log("refused", name, value, auth, "missing, unissued or expired authorisation")
            raise SafetyError("missing or expired authorisation")
        lim = self.limits.get(name)
        if lim is None:
            self._log("refused", name, value, auth, "unknown command")
            raise SafetyError(f"unknown command '{name}'")
        if not (lim.low <= value <= lim.high):
            self._log("refused", name, value, auth, f"outside limits [{lim.low}, {lim.high}] {lim.unit}")
            raise SafetyError(f"{name}={value} outside operating limits [{lim.low}, {lim.high}] {lim.unit}")
        self._dispatch(name, value)
        self.state[name] = value
        self._log("executed", name, value, auth, "")
        return {"device_id": self.device_id, "command": name, "value": value, "status": "executed"}

    def emergency_stop(self, actor: str) -> None:
        self.estop = True
        self._safe_state()
        self.ledger.append("instrument_estop", {"device_id": self.device_id}, actor)

    def reset_estop(self, auth: Authorisation) -> None:
        if not self._authorised(auth):
            raise SafetyError("reset requires valid authorisation")
        self.estop = False
        self.ledger.append("instrument_estop_reset", {"device_id": self.device_id}, auth.operator)

    def _log(self, outcome, name, value, auth, reason):
        self.ledger.append("instrument_command", {"device_id": self.device_id, "command": name, "value": value,
                                                  "outcome": outcome, "reason": reason,
                                                  "operator": getattr(auth, "operator", None)},
                           getattr(auth, "operator", "unknown"))

    def _dispatch(self, name, value):
        raise NotImplementedError

    def _safe_state(self):
        pass


class SimulatedInstrument(InstrumentAdapter):
    """Software stand-in for a spin-readout + gradient-coil controller. All output is SYNTHETIC."""

    def _dispatch(self, name, value):
        pass

    def acquire(self, auth: Authorisation, rho: np.ndarray, settings: list[str], shots: int, seed: int) -> dict:
        from .sigproc import simulate_counts, DetectorModel
        if self.estop or not self._authorised(auth):
            raise SafetyError("acquisition refused")
        rec = simulate_counts(rho, settings, shots, DetectorModel(), seed, "simulated-instrument",
                              {"device_id": self.device_id, "state": dict(self.state)})
        self.ledger.append("acquisition", {"device_id": self.device_id, "label": "SYNTHETIC", "sha256": rec["sha256"]},
                           auth.operator)
        return rec


class FileReplayInstrument(InstrumentAdapter):
    """Replays an instrument-native file. Labelled REAL only with an operator attestation of provenance."""

    def _dispatch(self, name, value):
        raise SafetyError("replay adapter accepts no hardware commands")

    def ingest(self, auth: Authorisation, data: bytes, attested_real: bool, instrument_serial: str,
               calibration_ref: str) -> dict:
        if not self._authorised(auth):
            raise SafetyError("ingest requires authorisation")
        label = "REAL" if attested_real else "SYNTHETIC"
        rec = {"device_id": self.device_id, "label": label, "sha256": sha256_bytes(data), "bytes": len(data),
               "instrument_serial": instrument_serial, "calibration_ref": calibration_ref,
               "attested_by": auth.operator if attested_real else None}
        self.ledger.append("acquisition", rec, auth.operator)
        return rec


def default_simulated(ledger: Ledger) -> SimulatedInstrument:
    return SimulatedInstrument("sim-spin-readout-01", "Simulated NV spin readout and gradient-coil controller (SYNTHETIC)",
                               {"gradient_T_per_m": Limit(0, 1e7, "T/m"), "microwave_power_dBm": Limit(-60, 10, "dBm"),
                                "laser_power_mW": Limit(0, 5, "mW"), "hold_time_s": Limit(0, 10, "s")}, ledger, connected=True)
