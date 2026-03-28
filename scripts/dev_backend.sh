#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/common.sh"

studioos_load_root_env

cd "${ROOT_DIR}/backend"

if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
  exec "${ROOT_DIR}/.venv/bin/python" -m uvicorn main:app --host 0.0.0.0 --port 8090 --reload
fi

studioos_require_cmd uvicorn
exec uvicorn main:app --host 0.0.0.0 --port 8090 --reload
