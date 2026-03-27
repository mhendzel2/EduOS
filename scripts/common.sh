#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

studioos_load_root_env() {
  local env_file="${ROOT_DIR}/.env"

  if [ ! -f "${env_file}" ]; then
    return 0
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    line="${line%$'\r'}"
    case "${line}" in
      ''|\#*)
        continue
        ;;
    esac

    local key="${line%%=*}"
    local value="${line#*=}"

    if [ -z "${key}" ] || [ "${key}" = "${line}" ]; then
      continue
    fi

    if [ -n "${!key+x}" ]; then
      continue
    fi

    export "${key}=${value}"
  done < "${env_file}"
}

studioos_require_cmd() {
  local command_name="$1"

  if command -v "${command_name}" >/dev/null 2>&1; then
    return 0
  fi

  printf 'Missing required command: %s\n' "${command_name}" >&2
  exit 1
}
