#!/bin/bash
set -euo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onparmarketing/OnParBeverageRecipes-service}"
SOURCE_REPO="${ONPAR_SOURCE_REPO:-${PROJECT_DIR}}"
SERVICE_URL="${ONPAR_SERVICE_URL:-http://127.0.0.1:3000}"
EXPECTED_SHA="${1:-}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:${PROJECT_DIR}/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ ! -d "${SOURCE_REPO}/.git" ]; then
  echo "${SOURCE_REPO} is not the dashboard source Git checkout." >&2
  exit 1
fi

CHECK_REF="${EXPECTED_SHA:-}"
if [ -z "${CHECK_REF}" ] && [ -f "${PROJECT_DIR}/current/.onpar-release-sha" ]; then
  CHECK_REF="$(sed -n '1p' "${PROJECT_DIR}/current/.onpar-release-sha")"
fi
CHECK_REF="${CHECK_REF:-HEAD}"
if ! CHECK_SHA="$(git -C "${SOURCE_REPO}" rev-parse --verify "${CHECK_REF}^{commit}" 2>/dev/null)"; then
  echo "Dashboard smoke test could not resolve target ${CHECK_REF}." >&2
  exit 1
fi

HAS_VERSION_ENDPOINT=0
HAS_HEALTH_ENDPOINT=0
if git -C "${SOURCE_REPO}" cat-file -e "${CHECK_SHA}:app/api/version/route.js" 2>/dev/null; then
  HAS_VERSION_ENDPOINT=1
fi
if git -C "${SOURCE_REPO}" cat-file -e "${CHECK_SHA}:app/api/health/route.js" 2>/dev/null; then
  HAS_HEALTH_ENDPOINT=1
fi

if [ "${HAS_VERSION_ENDPOINT}" -ne "${HAS_HEALTH_ENDPOINT}" ]; then
  echo "Dashboard smoke test failed: target ${CHECK_SHA} contains only one required observability endpoint." >&2
  exit 1
fi

if [ "${HAS_VERSION_ENDPOINT}" -eq 0 ]; then
  ROOT_STATUS=""
  for attempt in $(seq 1 15); do
    ROOT_STATUS="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${SERVICE_URL}/" 2>/dev/null || true)"
    case "${ROOT_STATUS}" in
      2??|3??)
        printf '{"ok":true,"mode":"legacy-root","commit":"%s","httpStatus":%s}\n' "${CHECK_SHA}" "${ROOT_STATUS}"
        exit 0
        ;;
    esac
    if [ "${attempt}" -lt 15 ]; then
      sleep 2
    fi
  done

  echo "Dashboard legacy smoke test failed: ${SERVICE_URL}/ was not reachable within 30 seconds (last status ${ROOT_STATUS:-none})." >&2
  exit 1
fi

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
  echo "Node.js 22 is required to validate modern smoke-test responses." >&2
  exit 1
fi

HEALTH_SUFFIX="?storage=1"
if [ "${ONPAR_SMOKE_DEEP:-0}" = "1" ]; then
  HEALTH_SUFFIX="?storage=1&deep=1"
fi

VERSION_JSON=""
HEALTH_JSON=""
for attempt in $(seq 1 15); do
  if VERSION_JSON="$(curl --fail --silent --show-error --max-time 5 "${SERVICE_URL}/api/version" 2>/dev/null)" \
    && HEALTH_JSON="$(curl --fail --silent --show-error --max-time 10 "${SERVICE_URL}/api/health${HEALTH_SUFFIX}" 2>/dev/null)"; then
    break
  fi
  VERSION_JSON=""
  HEALTH_JSON=""
  if [ "${attempt}" -lt 15 ]; then
    sleep 2
  fi
done

if [ -z "${VERSION_JSON}" ] || [ -z "${HEALTH_JSON}" ]; then
  echo "Dashboard smoke test failed: ${SERVICE_URL} was not healthy within 30 seconds." >&2
  exit 1
fi

"${NODE_BIN}" -e '
const expected = process.argv[1];
const version = JSON.parse(process.argv[2]);
const health = JSON.parse(process.argv[3]);
if (version.service !== "onpar-beverage-dashboard") throw new Error("Unexpected service identity.");
if (expected && version.commit !== expected.toLowerCase()) {
  throw new Error(`Running commit ${version.commit} does not match deployed commit ${expected}.`);
}
if (health.ok !== true) throw new Error(`Health check failed with status ${health.status || "unknown"}.`);
console.log(JSON.stringify({
  ok: true,
  version: version.version,
  commit: version.commit,
  target: version.target,
  health: health.status,
  parAgent: health.lastKnown?.parAgent?.status || "unavailable",
}));
' "${CHECK_SHA}" "${VERSION_JSON}" "${HEALTH_JSON}"
