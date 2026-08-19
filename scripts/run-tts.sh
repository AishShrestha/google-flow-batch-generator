#!/bin/bash
# Wrapper script to run Kokoro TTS via the Python venv
# Passes all arguments through to kokoro_tts.py

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Activate venv if it exists, otherwise use system python
if [ -f ".venv/bin/python" ]; then
    .venv/bin/python src/tts/kokoro_tts.py "$@"
else
    echo "Error: Python venv not found. Run 'npm run setup-tts' first."
    exit 1
fi