"""Helpers for driving the CLI the way a user (or another agent) would."""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class CliRun:
    returncode: int
    stdout: str
    stderr: str


def run_cli(*args: str) -> CliRun:
    import os

    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT / "src")
    proc = subprocess.run(
        [sys.executable, "-m", "sodar", *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    return CliRun(proc.returncode, proc.stdout, proc.stderr)
