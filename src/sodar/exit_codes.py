"""Process exit codes for the `sodar` CLI.

Stable contract — other agents and scripts branch on these numbers.
"""

OK = 0
"""Command succeeded."""

USAGE = 2
"""Invalid user input: unknown command, missing/extra arguments, unknown
provider id, unknown fixture id. (argparse also exits 2 on its own errors.)"""

FIXTURE = 3
"""The fixture could not be used: its manifest is malformed, or the provider
rejected the fixture's input during validation."""

PROVIDER = 4
"""The provider ran but failed: `execute()` raised, or returned success=False."""

INTERNAL = 5
"""Harness/evaluator fault: could not persist a run, produced an eval result
that does not match the schema, or an unexpected exception."""
