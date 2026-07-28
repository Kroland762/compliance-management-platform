#!/usr/bin/env bash
set -euo pipefail

apply=false
if [[ "${1:-}" == "--apply" ]]; then apply=true; fi

backup_root="${BACKUP_DIR:-./backups}"
upload_root="${UPLOAD_DIR:-./uploads}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_file="${backup_root%/}/compliance-${timestamp}.tar.enc"
encryption_key="${BACKUP_ENCRYPTION_KEY:-}"
export PGPASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"

if [[ -z "${DB_NAME:-}" || -z "${DB_USER:-}" ]]; then
  echo "DB_NAME and DB_USER are required" >&2
  exit 1
fi
if [[ "$apply" != true ]]; then
  echo "DRY RUN: would back up database '${DB_NAME}' and uploads '${upload_root}' to '${output_file}'"
  echo "Run with --apply and BACKUP_ENCRYPTION_KEY to create the encrypted backup."
  exit 0
fi
if [[ ${#encryption_key} -lt 24 ]]; then
  echo "BACKUP_ENCRYPTION_KEY must contain at least 24 characters" >&2
  exit 1
fi

mkdir -p "$backup_root"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/compliance-backup.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --host="${DB_HOST:-localhost}" \
  --port="${DB_PORT:-5432}" \
  --username="$DB_USER" \
  --file="$work_dir/database.dump" \
  "$DB_NAME"

if [[ -d "$upload_root" ]]; then
  tar -C "$upload_root" -cf "$work_dir/uploads.tar" .
else
  tar -cf "$work_dir/uploads.tar" --files-from /dev/null
fi

(
  cd "$work_dir"
  shasum -a 256 database.dump uploads.tar > SHA256SUMS
  tar -cf - database.dump uploads.tar SHA256SUMS
) | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -out "$output_file"

shasum -a 256 "$output_file" > "${output_file}.sha256"
echo "Backup created: $output_file"
