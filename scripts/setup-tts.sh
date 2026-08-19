#!/bin/bash
# One-time setup for Kokoro TTS
# Installs Python venv, dependencies, and downloads model files

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "=== Kokoro TTS Setup ==="
echo

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed."
    echo "Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Check for espeak-ng
if ! command -v espeak-ng &> /dev/null; then
    echo "Installing espeak-ng via Homebrew..."
    brew install espeak-ng
fi

# Create Python venv
echo "Creating Python 3.12 virtual environment..."
uv venv .venv -p 3.12

# Install Python dependencies
echo "Installing Python dependencies..."
source .venv/bin/activate
uv pip install kokoro-onnx soundfile

# Download model files
echo "Downloading model files..."
mkdir -p models

if [ ! -f "models/kokoro-v1.0.onnx" ]; then
    echo "  Downloading kokoro-v1.0.int8.onnx (~109MB, quantized)..."
    curl -L -o models/kokoro-v1.0.onnx \
        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx
    echo "  (To use the full f32 model instead, download kokoro-v1.0.onnx from the releases page)"
fi

if [ ! -f "models/voices-v1.0.bin" ]; then
    echo "  Downloading voices-v1.0.bin..."
    curl -L -o models/voices-v1.0.bin \
        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin
fi

# Create output directory
mkdir -p output/audio

echo
echo "=== Setup Complete ==="
echo
echo "Usage:"
echo "  npm run tts -- script.txt"
echo "  npm run tts -- script.txt --voice af_heart --speed 1.1"
echo "  npm run tts -- --list-voices"
echo
echo "Model files:  models/"
echo "Python venv:  .venv/"
echo "Audio output: output/audio/"