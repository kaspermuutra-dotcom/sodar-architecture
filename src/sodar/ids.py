"""Run identifiers and timestamps.

`run_id` is intentionally *not* deterministic — each run must land in its own
directory and never overwrite a previous one. Everything a caller compares for
determinism (metrics, estimated cost, artifact hashes) is computed elsewhere
and does not depend on the run id or the wall clock.
"""

from __future__ import annotations

import time


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string, e.g. ``2026-08-28T12:34:56Z``."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_run_id() -> str:
    """A sortable, collision-resistant run id: ``<utc-compact>-<ns-suffix>``.

    The nanosecond suffix disambiguates runs started within the same second.
    The evaluator additionally refuses to reuse an existing directory, so a
    (vanishingly unlikely) clash is still handled.
    """
    now_ns = time.time_ns()
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now_ns / 1_000_000_000))
    return f"{stamp}-{now_ns % 1_000_000:06d}"
