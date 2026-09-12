#!/bin/bash
set -euo pipefail

# Dedicated, local-only daemon. Do not expose this port through the public tunnel.
# Install a reviewed Ollama build and a suitable LOCAL tool-capable model first.
ollama_bin="${ONPAR_OLLAMA_BIN:-}"
if [ -z "${ollama_bin}" ]; then
  ollama_bin="$(command -v ollama || true)"
fi
if [ -z "${ollama_bin}" ] || [ ! -x "${ollama_bin}" ]; then
  printf '%s\n' 'Ollama is not installed or ONPAR_OLLAMA_BIN is not configured.' >&2
  exit 1
fi
export OLLAMA_HOST=127.0.0.1:11435
export OLLAMA_NO_CLOUD=1
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_MAX_QUEUE=1
export OLLAMA_KEEP_ALIVE=5m
exec "${ollama_bin}" serve
