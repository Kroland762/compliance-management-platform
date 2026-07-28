#!/usr/bin/env bash
set -euo pipefail

apply=false
if [[ "${1:-}" == "--apply" ]]; then apply=true; fi

backup_file="${BACKUP_FILE:-}"
target_db="${RESTORE_DB_NAME:-}"
restore_upload_dir="${RESTORE_UPLOAD_DIR:-}"
encryption_key="${BACKUP_ENCRYPTION_KEY:-}"
export PGPASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"

if [[ -z "$backup_file" || -z "$target_db" || -z "$restore_upload_dir" ]]; then
  echo "BACKUP_FILE, RESTORE_DB_NAME and RESTORE_UPLOAD_DIR are required" >&2
  exit 1
fi
if [[ "$restore_upload_dir" == "/" || "$restore_upload_dir" == "$HOME" ]]; then
  echo "Refusing broad RESTORE_UPLOAD_DIR target" >&2
  exit 1
fi
if [[ "$apply" != true ]]; then
  echo "DRY RUN: would verify '$backup_file', restore into database '$target_db', and extract uploads to '$restore_upload_dir'"
  exit 0
fi
if [[ "${RESTORE_CONFIRM_DB:-}" != "$target_db" ]]; then
  echo "Set RESTORE_CONFIRM_DB exactly to '$target_db' to confirm the target" >&2
  exit 1
fi
if [[ ${#encryption_key} -lt 24 ]]; then
  echo "BACKUP_ENCRYPTION_KEY must contain at least 24 characters" >&2
  exit 1
fi
if [[ -e "$restore_upload_dir" ]] && [[ -n "$(find "$restore_upload_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "RESTORE_UPLOAD_DIR must be absent or empty" >&2
  exit 1
fi

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/compliance-restore.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$backup_file" \
  | tar -C "$work_dir" -xf -
(
  cd "$work_dir"
  shasum -a 256 -c SHA256SUMS
)

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --host="${DB_HOST:-localhost}" \
  --port="${DB_PORT:-5432}" \
  --username="${DB_USER:?DB_USER is required}" \
  --dbname="$target_db" \
  "$work_dir/database.dump"

mkdir -p "$restore_upload_dir"
tar -C "$restore_upload_dir" -xf "$work_dir/uploads.tar"
echo "Restore completed into '$target_db' and '$restore_upload_dir'"
