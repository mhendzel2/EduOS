#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/common.sh"

studioos_require_cmd npm
studioos_load_root_env

cd "${ROOT_DIR}/frontend"
exec npm run dev -- --hostname 0.0.0.0 --port 3015
