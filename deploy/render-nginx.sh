#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env}"
output_file="${2:-/tmp/compliance-nginx.conf}"
template_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nginx/compliance.conf.template"

if [[ ! -f "$env_file" ]]; then
  echo "Missing environment file: $env_file" >&2
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

domain="$(value_for DOMAIN)"
backend_port="$(value_for BACKEND_HOST_PORT)"
frontend_port="$(value_for FRONTEND_HOST_PORT)"
backend_port="${backend_port:-3001}"
frontend_port="${frontend_port:-8080}"

if [[ ! "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
  echo "DOMAIN must be a hostname without scheme or path" >&2
  exit 1
fi
for port in "$backend_port" "$frontend_port"; do
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    echo "Nginx upstream ports must be integers between 1 and 65535" >&2
    exit 1
  fi
done

sed \
  -e "s/__DOMAIN__/$domain/g" \
  -e "s/__BACKEND_PORT__/$backend_port/g" \
  -e "s/__FRONTEND_PORT__/$frontend_port/g" \
  "$template_file" > "$output_file"

echo "Rendered Nginx configuration: $output_file"
