#!/bin/sh
# Fixed-path, fail-closed startup guard for the local 4B container candidate.
# qmd-index.json is derived data. Keep each previous cache before app rebuild.
set -eu
umask 077

fail() {
  printf '%s\n' "runtime-guard: $1" >&2
  exit 1
}

DATA_DIR=/data
VAULT_PATH=/vault
ALLOWED_ROOTS=/vault
readonly DATA_DIR VAULT_PATH ALLOWED_ROOTS
export DATA_DIR VAULT_PATH ALLOWED_ROOTS
CACHE_PATH=/data/qmd-index.json
HISTORY_DIR=/data/index-cache-history
readonly CACHE_PATH HISTORY_DIR

runtime_uid=$(id -u) || fail 'cannot determine runtime UID'
[ "$runtime_uid" = 1000 ] || fail 'runtime UID must be 1000'

check_directory() {
  [ ! -L "$1" ] || fail "$2 must not be a symlink"
  [ -d "$1" ] || fail "$2 must be a directory"
  directory_uid=$(stat -c '%u' "$1" 2>/dev/null) || fail "cannot inspect $2 ownership"
  [ "$directory_uid" = 1000 ] || fail "$2 owner must be UID 1000"
}

check_directory "$DATA_DIR" '/data'
check_directory "$VAULT_PATH" '/vault'

cache_present=0
if [ -e "$CACHE_PATH" ] || [ -L "$CACHE_PATH" ]; then
  [ ! -L "$CACHE_PATH" ] || fail 'cache must not be a symlink'
  [ -f "$CACHE_PATH" ] || fail 'cache must be a regular file'
  cache_uid=$(stat -c '%u' "$CACHE_PATH" 2>/dev/null) || fail 'cannot inspect cache ownership'
  [ "$cache_uid" = 1000 ] || fail 'cache owner must be UID 1000'
  cache_present=1
fi

if [ ! -e "$HISTORY_DIR" ] && [ ! -L "$HISTORY_DIR" ]; then
  mkdir "$HISTORY_DIR" || fail 'cannot create cache history directory'
fi
check_directory "$HISTORY_DIR" 'cache history directory'
history_mode=$(stat -c '%a' "$HISTORY_DIR" 2>/dev/null) || fail 'cannot inspect cache history mode'
[ "$history_mode" = 700 ] || fail 'cache history directory mode must be 0700'

if [ "$cache_present" = 1 ]; then
  cache_device=$(stat -c '%d' "$CACHE_PATH" 2>/dev/null) || fail 'cannot inspect cache filesystem'
  history_device=$(stat -c '%d' "$HISTORY_DIR" 2>/dev/null) || fail 'cannot inspect cache history filesystem'
  [ "$cache_device" = "$history_device" ] || fail 'cache history must use the cache filesystem'

  stamp=$(date -u '+%Y%m%dT%H%M%SZ') || fail 'cannot determine cache history timestamp'
  case "$stamp" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *) fail 'invalid cache history timestamp' ;;
  esac

  # mkdir reserves a fresh private destination atomically. Even a collision
  # fails closed: never reuse an old slot or continue after a failed mkdir.
  archive_dir="$HISTORY_DIR/$stamp-pid-$$-0"
  mkdir "$archive_dir" || fail 'cannot reserve cache history destination'
  # Both paths are on the verified filesystem. Moving into the newly reserved
  # directory retains the original inode; no existing history file is a target.
  mv "$CACHE_PATH" "$archive_dir/qmd-index.json" || fail 'cannot preserve previous cache'
fi

exec node /app/server/dist/index.js
