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

if [ ! -f "${PROJECT_DIR}/node_modules/next/dist/bin/next" ]; then
  echo "Next.js is not installed in ${PROJECT_DIR}; run npm ci first." >&2
  exit 1
fi

if [ ! -f "${PROJECT_DIR}/.next/BUILD_ID" ]; then
  echo "No production build was found in ${PROJECT_DIR}; run npm run build first." >&2
  exit 1
fi

if [ -z "${ONPAR_BUILD_SHA:-}" ] && [ -f "${PROJECT_DIR}/.onpar-release-sha" ]; then
  ONPAR_BUILD_SHA="$(sed -n '1p' "${PROJECT_DIR}/.onpar-release-sha")"
  export ONPAR_BUILD_SHA
elif [ -z "${ONPAR_BUILD_SHA:-}" ] && [ -d "${PROJECT_DIR}/.git" ] && command -v git >/dev/null 2>&1; then
  ONPAR_BUILD_SHA="$(git -C "${PROJECT_DIR}" rev-parse HEAD 2>/dev/null || true)"
  export ONPAR_BUILD_SHA
fi

if [ -z "${ONPAR_BUILD_TIMESTAMP:-}" ] && [ -f "${PROJECT_DIR}/.onpar-build-timestamp" ]; then
  ONPAR_BUILD_TIMESTAMP="$(sed -n '1p' "${PROJECT_DIR}/.onpar-build-timestamp")"
  export ONPAR_BUILD_TIMESTAMP
elif [ -z "${ONPAR_BUILD_TIMESTAMP:-}" ] && [ -d "${PROJECT_DIR}/.git" ] && command -v git >/dev/null 2>&1; then
  ONPAR_BUILD_TIMESTAMP="$(git -C "${PROJECT_DIR}" show -s --format=%cI HEAD 2>/dev/null || true)"
  export ONPAR_BUILD_TIMESTAMP
fi

export NODE_ENV="production"
export ONPAR_DEPLOYMENT_TARGET="${ONPAR_DEPLOYMENT_TARGET:-on-site}"

cd "${PROJECT_DIR}"
exec "${NODE_BIN}" "${PROJECT_DIR}/node_modules/next/dist/bin/next" start -H 127.0.0.1 -p 3000
