#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv311/bin/python ]; then
  PYTHON_BIN="$(command -v python3.11 || command -v python3)"
  "$PYTHON_BIN" -m venv .venv311
fi
if ! .venv311/bin/python -c "import fastapi, uvicorn, ortools, openpyxl, reportlab, httpcloak, requests, dotenv, pypdf, xlrd, pyxlsb, PIL" 2>/dev/null; then
  .venv311/bin/python -m pip install -r requirements-lock.txt
fi
exec .venv311/bin/python -m uvicorn backend.main:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}"
