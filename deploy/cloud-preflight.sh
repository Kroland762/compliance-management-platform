#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env}"
compose_file="${COMPOSE_FILE:-docker-compose.yml}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing environment file: $env_file" >&2
  exit 1
fi
if [[ ! -f "$compose_file" ]]; then
  echo "Missing compose file: $compose_file" >&2
  exit 1
fi

env_mode=""
if stat -f '%Lp' "$env_file" >/dev/null 2>&1; then
  env_mode="$(stat -f '%Lp' "$env_file")"
elif stat -c '%a' "$env_file" >/dev/null 2>&1; then
  env_mode="$(stat -c '%a' "$env_file")"
fi
if [[ -n "$env_mode" && "$env_mode" != "600" && "$env_mode" != "640" ]]; then
  echo "$env_file must use permission mode 600 or 640 (current: $env_mode)" >&2
  exit 1
fi

value_for() {
  local key="$1"
  awk -v expected="$key" '
    $0 !~ /^[[:space:]]*#/ {
      split($0, parts, "=")
      if (parts[1] == expected) {
        sub(/^[^=]*=/, "")
        value = $0
      }
    }
    END { print value }
  ' "$env_file"
}

require_value() {
  local key="$1"
  local value
  value="$(value_for "$key")"
  if [[ -z "$value" ]]; then
    echo "$key is required in $env_file" >&2
    exit 1
  fi
  if [[ "$value" == *replace-with* || "$value" == *example.com* || "$value" == *load-from* ]]; then
    echo "$key still contains an example placeholder" >&2
    exit 1
  fi
  printf '%s' "$value"
}

require_secret() {
  local key="$1"
  local minimum="$2"
  local value
  value="$(require_value "$key")"
  if (( ${#value} < minimum )); then
    echo "$key must contain at least $minimum characters" >&2
    exit 1
  fi
}

domain="$(require_value DOMAIN)"
email="$(require_value LETSENCRYPT_EMAIL)"
if [[ ! "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
  echo "DOMAIN must be a hostname without scheme or path" >&2
  exit 1
fi
if [[ ! "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "LETSENCRYPT_EMAIL must be a valid email address" >&2
  exit 1
fi

require_secret DB_PASSWORD 16
require_secret JWT_SECRET 32
require_secret ENCRYPTION_KEY 32
require_secret METRICS_TOKEN 24

backup_key_file="$(require_value BACKUP_KEY_FILE)"
backup_host_dir="$(require_value BACKUP_HOST_DIR)"
restore_host_dir="$(require_value RESTORE_HOST_DIR)"
for absolute_path in "$backup_key_file" "$backup_host_dir" "$restore_host_dir"; do
  if [[ "$absolute_path" != /* ]]; then
    echo "Production backup and restore paths must be absolute: $absolute_path" >&2
    exit 1
  fi
done
if [[ ! -f "$backup_key_file" ]]; then
  echo "BACKUP_KEY_FILE does not exist: $backup_key_file" >&2
  exit 1
fi
key_mode=""
if stat -f '%Lp' "$backup_key_file" >/dev/null 2>&1; then
  key_mode="$(stat -f '%Lp' "$backup_key_file")"
elif stat -c '%a' "$backup_key_file" >/dev/null 2>&1; then
  key_mode="$(stat -c '%a' "$backup_key_file")"
fi
if [[ -n "$key_mode" && "$key_mode" != "600" ]]; then
  echo "BACKUP_KEY_FILE must use permission mode 600 (current: $key_mode)" >&2
  exit 1
fi
for required_dir in "$backup_host_dir" "$restore_host_dir"; do
  if [[ ! -d "$required_dir" ]]; then
    echo "Required backup/restore directory does not exist: $required_dir" >&2
    exit 1
  fi
done

for port_key in DB_HOST_PORT BACKEND_HOST_PORT FRONTEND_HOST_PORT; do
  port="$(require_value "$port_key")"
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "$port_key must be an integer between 1 and 65535" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required" >&2
  exit 1
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
echo "Cloud deployment preflight passed for $domain"
