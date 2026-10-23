#!/usr/bin/env bash
set -euo pipefail
SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
command -v python3 >/dev/null || { printf 'ERROR: Python 3.9+ required\n' >&2; exit 1; }
python3 -c 'import sys; assert sys.version_info >= (3,9), "Python 3.9+ required"'
exec python3 "$SELF_DIR/deploy.py" "$@"
