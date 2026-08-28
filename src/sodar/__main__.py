"""Enable `python -m sodar ...` (equivalent to the `sodar` console script)."""

from sodar.cli.main import main

if __name__ == "__main__":
    raise SystemExit(main())
