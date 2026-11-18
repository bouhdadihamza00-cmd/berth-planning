#!/bin/sh
# Start the app and its local-only AI server; reuse an already-running model server.
set -eu
cd "$(dirname "$0")/.."
mkdir -p .local-ai
model_pid=''
app_pid=''
cleanup() {
  if [ -n "$app_pid" ]; then kill "$app_pid" 2>/dev/null || true; fi
  if [ -n "$model_pid" ]; then kill "$model_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
if ! curl -fsS --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  ./scripts/start-local-ai.sh >.local-ai/server.log 2>&1 &
  model_pid=$!
  attempt=0
  until curl -fsS --max-time 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 20 ]; then
      echo 'The local AI server did not start. See .local-ai/server.log.' >&2
      exit 1
    fi
    sleep 1
  done
fi
./scripts/start.sh &
app_pid=$!
wait "$app_pid"
