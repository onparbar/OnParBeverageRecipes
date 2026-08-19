#!/bin/bash
set -Eeuo pipefail

SOURCE_REPO="${ONPAR_SOURCE_REPO:-/Users/onpar/OnParBeverageRecipes-source}"
SERVICE_DIR="${ONPAR_SERVICE_DIR:-/Users/onpar/OnParBeverageRecipes-service}"
RELEASE_PARENT="${ONPAR_RELEASE_PARENT:-/Users/onpar}"
PM2_APP_NAME="${ONPAR_PM2_APP_NAME:-onpar-dashboard}"
SERVICE_USER="${ONPAR_SERVICE_USER:-onpar}"
TARGET_REF="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_DIR="${ONPAR_DEPLOY_HELPER_DIR:-${SCRIPT_DIR}}"
SMOKE_HELPER="${HELPER_DIR}/smoke-on-site.sh"
DEPLOY_DIR="${SERVICE_DIR}/.deploy"
LOCAL_URL="${ONPAR_LOCAL_URL:-http://127.0.0.1:3000}"
PUBLIC_URL="${ONPAR_PUBLIC_URL:-https://onparbev.com}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ "$(id -un)" != "${SERVICE_USER}" ]; then
  echo "PM2 rollback must run as ${SERVICE_USER}." >&2
  exit 1
fi
if [ ! -d "${SOURCE_REPO}/.git" ]; then
  echo "Source checkout is missing at ${SOURCE_REPO}." >&2
  exit 1
fi
if [ ! -f "${HELPER_DIR}/pm2-release-common.sh" ] || [ ! -x "${SMOKE_HELPER}" ]; then
  echo "PM2 rollback helpers are incomplete in ${HELPER_DIR}." >&2
  exit 1
fi
# shellcheck source=scripts/pm2-release-common.sh
source "${HELPER_DIR}/pm2-release-common.sh"

if [ -n "$(onpar_pm2_source_changes "${SOURCE_REPO}")" ]; then
  echo "Rollback stopped because the source checkout has uncommitted files." >&2
  exit 1
fi
onpar_pm2_validate_runtime "${SERVICE_DIR}" "${UID}"
NODE_BIN="$(onpar_pm2_select_node22 "${SOURCE_REPO}" "${SERVICE_DIR}")"
NPM_BIN="$(onpar_pm2_find_npm "${NODE_BIN}")"
PM2_BIN="$(onpar_pm2_find_binary)"

CURRENT_INFO="$(onpar_pm2_app_info "${PM2_BIN}" "${NODE_BIN}" "${PM2_APP_NAME}" 2>/dev/null || true)"
IFS='|' read -r CURRENT_RELEASE CURRENT_STATUS CURRENT_ENV_SHA CURRENT_ENV_TIME <<< "${CURRENT_INFO}"
if [ -z "${CURRENT_RELEASE}" ] || [ "${CURRENT_STATUS}" != "online" ] || [ ! -d "${CURRENT_RELEASE}" ]; then
  echo "Existing PM2 app ${PM2_APP_NAME} must be online before rollback." >&2
  exit 1
fi
CURRENT_SHA="$(onpar_pm2_release_sha "${SOURCE_REPO}" "${CURRENT_RELEASE}" || true)"
CURRENT_IDENTITY="$(onpar_pm2_release_identity "${CURRENT_RELEASE}" "${CURRENT_ENV_SHA}" || true)"

TARGET_RELEASE=""
TARGET_SHA=""
if [ -n "${TARGET_REF}" ]; then
  TARGET_SHA="$(git -C "${SOURCE_REPO}" rev-parse --verify "${TARGET_REF}^{commit}")"
  onpar_pm2_prepare_release \
    "${SOURCE_REPO}" "${SERVICE_DIR}" "${RELEASE_PARENT}" \
    "${TARGET_SHA}" "${NODE_BIN}" "${NPM_BIN}"
  TARGET_RELEASE="${ONPAR_PM2_PREPARED_RELEASE}"
else
  if [ ! -f "${DEPLOY_DIR}/previous-release" ]; then
    echo "No previous PM2 release is recorded. Pass an explicit commit SHA." >&2
    exit 1
  fi
  TARGET_RELEASE="$(sed -n '1p' "${DEPLOY_DIR}/previous-release")"
  onpar_pm2_validate_release_path "${RELEASE_PARENT}" "${TARGET_RELEASE}"
  TARGET_SHA="$(onpar_pm2_release_sha "${SOURCE_REPO}" "${TARGET_RELEASE}" || true)"
fi
TARGET_IDENTITY="$(onpar_pm2_release_identity "${TARGET_RELEASE}" "" || true)"

onpar_pm2_acquire_lock "${SERVICE_DIR}"
cleanup_lock() {
  onpar_pm2_release_lock "${ONPAR_PM2_LOCK_DIR}"
}
trap cleanup_lock EXIT

SWITCHED=0
restore_current_release() {
  local original_status=$?
  trap - ERR
  if [ "${SWITCHED}" -eq 1 ]; then
    echo "Rollback validation failed; restoring ${CURRENT_RELEASE}." >&2
    onpar_pm2_switch_release "${PM2_BIN}" "${NPM_BIN}" "${PM2_APP_NAME}" "${CURRENT_RELEASE}" "${CURRENT_IDENTITY}" "${CURRENT_ENV_TIME}" || true
    onpar_pm2_wait_for_release "${PM2_BIN}" "${NODE_BIN}" "${PM2_APP_NAME}" "${CURRENT_RELEASE}" || true
    onpar_pm2_smoke_release "${SMOKE_HELPER}" "${SOURCE_REPO}" "${CURRENT_RELEASE}" "${LOCAL_URL}" "${CURRENT_SHA}" || true
    onpar_pm2_public_smoke "${NODE_BIN}" "${PUBLIC_URL}" "${CURRENT_IDENTITY}" || true
  fi
  exit "${original_status}"
}
trap restore_current_release ERR

SWITCHED=1
onpar_pm2_switch_release "${PM2_BIN}" "${NPM_BIN}" "${PM2_APP_NAME}" "${TARGET_RELEASE}" "${TARGET_IDENTITY}" ""
onpar_pm2_wait_for_release "${PM2_BIN}" "${NODE_BIN}" "${PM2_APP_NAME}" "${TARGET_RELEASE}"
onpar_pm2_smoke_release "${SMOKE_HELPER}" "${SOURCE_REPO}" "${TARGET_RELEASE}" "${LOCAL_URL}" "${TARGET_SHA}"
onpar_pm2_public_smoke "${NODE_BIN}" "${PUBLIC_URL}" "${TARGET_IDENTITY}"
onpar_pm2_activate_link "${SERVICE_DIR}" "${TARGET_RELEASE}"

printf '%s\n' "${CURRENT_IDENTITY}" > "${DEPLOY_DIR}/previous-sha"
printf '%s\n' "${CURRENT_RELEASE}" > "${DEPLOY_DIR}/previous-release"
printf '%s\n' "${TARGET_IDENTITY}" > "${DEPLOY_DIR}/deployed-sha"
chmod 600 "${DEPLOY_DIR}/previous-sha" "${DEPLOY_DIR}/previous-release" "${DEPLOY_DIR}/deployed-sha"
trap - ERR
echo "Rolled back through PM2 to ${TARGET_IDENTITY:-${TARGET_RELEASE}}."
