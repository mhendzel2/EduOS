#!/usr/bin/env bash

set -u

STATUS_FILE="${OLLAMA_BOOTSTRAP_STATUS_FILE:-/tmp/studioos-ollama-bootstrap-status.json}"
LOG_FILE="${OLLAMA_BOOTSTRAP_LOG_FILE:-/tmp/studioos-ollama-bootstrap.log}"
BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
TARGET_MODEL="${1:-${TARGET_MODEL:-llama3}}"
STARTED_AT="$(date -Iseconds)"

mkdir -p "$(dirname "$STATUS_FILE")" "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$1" >>"$LOG_FILE"
}

write_status() {
  local state="$1"
  local message="$2"
  local completed_at="${3:-}"
  python3 - "$STATUS_FILE" "$state" "$message" "$TARGET_MODEL" "$BASE_URL" "$STARTED_AT" "$completed_at" <<'PY'
import json
import sys
from pathlib import Path

status_file, state, message, model, base_url, started_at, completed_at = sys.argv[1:8]
payload = {
    "state": state,
    "message": message,
    "model": model,
    "base_url": base_url,
    "started_at": started_at,
    "completed_at": completed_at or None,
}
Path(status_file).write_text(json.dumps(payload), encoding="utf-8")
PY
}

write_status "running" "Starting Ollama bootstrap"
log "Bootstrap requested for model ${TARGET_MODEL}"

if ! command -v ollama >/dev/null 2>&1; then
  log "ollama command not found in PATH"
  write_status "failed" "ollama command not found in PATH" "$(date -Iseconds)"
  exit 1
fi

if ! curl -fsS "${BASE_URL}/api/tags" >/dev/null 2>&1; then
  log "Ollama runtime not reachable at ${BASE_URL}; starting ollama serve"
  nohup ollama serve >>"$LOG_FILE" 2>&1 &
else
  log "Ollama runtime already reachable at ${BASE_URL}"
fi

ready=0
for _ in $(seq 1 45); do
  if curl -fsS "${BASE_URL}/api/tags" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  log "Ollama runtime did not become ready within 45 seconds"
  write_status "failed" "Ollama runtime did not become ready in time" "$(date -Iseconds)"
  exit 1
fi

log "Ollama runtime is reachable"

if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fx "$TARGET_MODEL" >/dev/null 2>&1; then
  log "Target model ${TARGET_MODEL} already available"
  write_status "succeeded" "Ollama is running and the target model is already available" "$(date -Iseconds)"
  exit 0
fi

log "Pulling target model ${TARGET_MODEL}"
if ! ollama pull "$TARGET_MODEL" >>"$LOG_FILE" 2>&1; then
  log "Failed to pull model ${TARGET_MODEL}"
  write_status "failed" "Failed to pull target model ${TARGET_MODEL}" "$(date -Iseconds)"
  exit 1
fi

log "Model ${TARGET_MODEL} is ready"
write_status "succeeded" "Ollama is running and the target model is ready" "$(date -Iseconds)"
