#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/common.sh"

studioos_require_cmd curl
studioos_require_cmd redis-cli
studioos_load_root_env

redis_url="${REDIS_URL:-redis://127.0.0.1:6379/0}"
backend_url="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:8015}"
frontend_url="${FRONTEND_URL:-http://127.0.0.1:3015}"

printf 'Checking Redis at %s\n' "${redis_url}"
redis-cli -u "${redis_url}" ping

printf 'Checking backend health at %s/api/v1/health\n' "${backend_url%/}"
curl -fsS "${backend_url%/}/api/v1/health" >/dev/null

printf 'Checking frontend at %s\n' "${frontend_url%/}"
curl -fsSI "${frontend_url%/}" >/dev/null

printf 'Local StudioOS stack checks passed.\n'
