#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
LOG_DIR="$PROJECT_DIR/.dev-logs"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PORT=3001
FRONTEND_PORT=5173
BACKEND_PID=""
FRONTEND_PID=""

read_env_value() {
  local env_file="$1"
  local key="$2"
  local fallback="$3"
  local value=""

  if [[ -f "$env_file" ]]; then
    value="$(awk -F= -v wanted="$key" '$1 == wanted { print $2; exit }' "$env_file" | tr -d '\r\"[:space:]')"
  fi
  printf '%s' "${value:-$fallback}"
}

BACKEND_PORT="$(read_env_value "$BACKEND_DIR/.env" PORT "$BACKEND_PORT")"

print_header() {
  printf '\n合规管理平台 · 本地开发环境\n'
  printf '项目目录：%s\n\n' "$PROJECT_DIR"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '缺少命令：%s\n' "$1" >&2
    exit 1
  fi
}

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

show_port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

url_is_ready() {
  curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

terminate_tree() {
  local pid="$1"
  local child=""

  [[ -n "$pid" ]] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    terminate_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM HUP

  if [[ -n "$FRONTEND_PID" || -n "$BACKEND_PID" ]]; then
    printf '\n正在关闭本次启动的服务...\n'
    terminate_tree "$FRONTEND_PID"
    terminate_tree "$BACKEND_PID"
  fi
  exit "$exit_code"
}

wait_for_service() {
  local name="$1"
  local url="$2"
  local pid="$3"
  local log_file="$4"
  local attempt=""

  for attempt in $(seq 1 60); do
    if url_is_ready "$url"; then
      printf '✓ %s已就绪\n' "$name"
      return 0
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      printf '✗ %s启动失败，最近日志：\n' "$name" >&2
      tail -n 40 "$log_file" 2>/dev/null || true
      return 1
    fi
    sleep 0.5
  done

  printf '✗ 等待%s启动超时，最近日志：\n' "$name" >&2
  tail -n 40 "$log_file" 2>/dev/null || true
  return 1
}

start_backend() {
  local health_url="http://127.0.0.1:$BACKEND_PORT/api/health"

  if url_is_ready "$health_url"; then
    printf '✓ 后端已在运行，直接复用（端口 %s）\n' "$BACKEND_PORT"
    return 0
  fi
  if port_in_use "$BACKEND_PORT"; then
    printf '✗ 端口 %s 已被其他进程占用，但后端健康检查失败：\n' "$BACKEND_PORT" >&2
    show_port_owner "$BACKEND_PORT"
    return 1
  fi

  printf '→ 启动后端...\n'
  : >"$BACKEND_LOG"
  (
    cd "$BACKEND_DIR"
    exec npm run dev
  ) >"$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  wait_for_service "后端" "$health_url" "$BACKEND_PID" "$BACKEND_LOG"
}

start_frontend() {
  local frontend_url="http://127.0.0.1:$FRONTEND_PORT"

  if url_is_ready "$frontend_url"; then
    printf '✓ 前端已在运行，直接复用（端口 %s）\n' "$FRONTEND_PORT"
    return 0
  fi
  if port_in_use "$FRONTEND_PORT"; then
    printf '✗ 端口 %s 已被其他进程占用，但前端访问失败：\n' "$FRONTEND_PORT" >&2
    show_port_owner "$FRONTEND_PORT"
    return 1
  fi

  printf '→ 启动前端...\n'
  : >"$FRONTEND_LOG"
  (
    cd "$FRONTEND_DIR"
    exec npm run dev -- --host 0.0.0.0
  ) >"$FRONTEND_LOG" 2>&1 &
  FRONTEND_PID=$!
  wait_for_service "前端" "$frontend_url" "$FRONTEND_PID" "$FRONTEND_LOG"
}

monitor_started_services() {
  local failed_name=""
  local failed_log=""

  if [[ -z "$BACKEND_PID" && -z "$FRONTEND_PID" ]]; then
    printf '\n服务均已在运行，本脚本未启动新进程。\n'
    return 0
  fi

  printf '\n服务运行中。按 Ctrl+C 可关闭本次由脚本启动的服务。\n'
  printf '日志目录：%s\n' "$LOG_DIR"
  while true; do
    if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      failed_name="后端"
      failed_log="$BACKEND_LOG"
      break
    fi
    if [[ -n "$FRONTEND_PID" ]] && ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
      failed_name="前端"
      failed_log="$FRONTEND_LOG"
      break
    fi
    sleep 2
  done

  printf '\n✗ %s意外停止，最近日志：\n' "$failed_name" >&2
  tail -n 40 "$failed_log" 2>/dev/null || true
  return 1
}

main() {
  print_header
  require_command node
  require_command npm
  require_command curl
  require_command lsof
  require_command nc
  require_command pgrep

  if [[ ! -d "$BACKEND_DIR/node_modules" || ! -d "$FRONTEND_DIR/node_modules" ]]; then
    printf '依赖尚未安装，请先分别在 backend 和 frontend 目录运行 npm install。\n' >&2
    exit 1
  fi

  mkdir -p "$LOG_DIR"
  trap cleanup EXIT INT TERM HUP

  local db_host
  local db_port
  db_host="$(read_env_value "$BACKEND_DIR/.env" DB_HOST localhost)"
  db_port="$(read_env_value "$BACKEND_DIR/.env" DB_PORT 5432)"
  if ! nc -z "$db_host" "$db_port" >/dev/null 2>&1; then
    printf '✗ 无法连接 PostgreSQL（%s:%s）。请先启动数据库，再重新双击此脚本。\n' "$db_host" "$db_port" >&2
    exit 1
  fi

  start_backend
  start_frontend

  printf '\n✓ 启动完成：http://localhost:%s\n' "$FRONTEND_PORT"
  if [[ "${NO_OPEN:-0}" != "1" ]] && command -v open >/dev/null 2>&1; then
    open "http://localhost:$FRONTEND_PORT"
  fi

  monitor_started_services
}

main "$@"
