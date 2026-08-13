#!/bin/bash
set -euo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onparmarketing/OnParBeverageRecipes-service}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:${PROJECT_DIR}/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

NODE_BIN=""
for candidate in \
  "${ONPAR_NODE_BIN:-}" \
  /opt/homebrew/opt/node@22/bin/node \
  /usr/local/opt/node@22/bin/node \
  "${PROJECT_DIR}/.tools/node/bin/node" \
  "$(command -v node 2>/dev/null || true)"; do
  if [ -n "${candidate}" ] && [ -x "${candidate}" ] \
    && [ "$("${candidate}" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)" = "22" ]; then
    NODE_BIN="${candidate}"
    break
  fi
done

if [ -z "${NODE_BIN}" ]; then
  echo "Node.js 22 was not found. Run scripts/setup-mac-tools.command first." >&2
  exit 1
fi

cd "${PROJECT_DIR}"
exec "${NODE_BIN}" "${PROJECT_DIR}/scripts/update-par-agent.mjs" "$@"
