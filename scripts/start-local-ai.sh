#!/bin/sh
# Local-only model server for this checkout. Models are not committed to Git.
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .local-ai/runtime/ollama ]; then
  echo 'Ollama runtime is missing. See docs/local-ai.md for installation.' >&2
  exit 1
fi
export OLLAMA_MODELS="$PWD/.local-ai/models"
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NO_CLOUD=1
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_CONTEXT_LENGTH=16384
export OLLAMA_KEEP_ALIVE=5m
exec .local-ai/runtime/ollama serve
