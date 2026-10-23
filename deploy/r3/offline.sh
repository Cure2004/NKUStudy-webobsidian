#!/usr/bin/env bash
set -euo pipefail
SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
command -v python3 >/dev/null || { printf 'ERROR: Python 3.9+ required\n' >&2; exit 1; }
python3 -c 'import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"'
export PYTHONDONTWRITEBYTECODE=1
case "${1:-}" in
  verify|load|init|start|resume)
    python3 -c 'import pathlib,sys; assert pathlib.Path(sys.argv[1]).resolve(strict=True)==pathlib.Path(sys.argv[2]).resolve(strict=True), "wrapper/package mismatch"' "${2:?package required}" "$SELF_DIR"
    python3 "$SELF_DIR/verify-package.py" "$SELF_DIR" ;;

esac
exec python3 "$SELF_DIR/deploy.py" "$@"
