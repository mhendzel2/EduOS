#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/common.sh"

studioos_require_cmd redis-server
studioos_load_root_env

redis_url="${REDIS_URL:-redis://127.0.0.1:6379/0}"
redis_target="${redis_url#redis://}"
redis_host_port="${redis_target%%/*}"
redis_host="${redis_host_port%:*}"
redis_port="${redis_host_port##*:}"

if [ -z "${redis_host}" ] || [ "${redis_host}" = "${redis_host_port}" ]; then
  redis_host="127.0.0.1"
fi

if [ -z "${redis_port}" ] || [ "${redis_port}" = "${redis_host_port}" ]; then
  redis_port="6379"
fi

printf 'Starting Redis on %s:%s\n' "${redis_host}" "${redis_port}"
exec redis-server --bind "${redis_host}" --port "${redis_port}" --save "" --appendonly no
