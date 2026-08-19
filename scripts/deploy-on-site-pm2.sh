#!/bin/bash
set -Eeuo pipefail

SOURCE_REPO="${ONPAR_SOURCE_REPO:-/Users/onpar/OnParBeverageRecipes-source}"
SERVICE_DIR="${ONPAR_SERVICE_DIR:-/Users/onpar/OnParBeverageRecipes-service}"
RELEASE_PARENT="${ONPAR_RELEASE_PARENT:-/Users/onpar}"
PM2_APP_NAME="${ONPAR_PM2_APP_NAME:-onpar-dashboard}"
SERVICE_USER="${ONPAR_SERVICE_USER:-onpar}"
TARGET_REF="${1:-origin/main}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_DIR="${ONPAR_DEPLOY_HELPER_DIR:-${SCRIPT_DIR}}"
SMOKE_HELPER="${HELPER_DIR}/smoke-on-site.sh"
DEPLOY_DIR="${SERVICE_DIR}/.deploy"
PUBLIC_URL="${ONPAR_PUBLIC_URL:-https://onparbev.com}"
LOCAL_URL="${ONPAR_LOCAL_URL:-http://127.0.0.1:3000}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ "$(id -un)" != "${SERVICE_USER}" ]; then
  echo "PM2 deployment must run as ${SERVICE_USER}." >&2
  exit 1
fi
if [ ! -d "${SOURCE_REPO}/.git" ]; then
  echo "Source checkout is missing at ${SOURCE_REPO}." >&2
  exit 1
fi
if [ ! -f "${HELPER_DIR}/pm2-release-common.sh" ] || [ ! -x "${SMOKE_HELPER}" ]; then
  echo "PM2 deployment helpers are incomplete in ${HELPER_DIR}." >&2
  exit 1
fi
# shellcheck source=scripts/pm2-release-common.sh
source "${HELPER_DIR}/pm2-release-common.sh"

if [ -n "$(onpar_pm2_source_changes "${SOURCE_REPO}")" ]; then
  echo "Deployment stopped because the source checkout has uncommitted files." >&2
  exit 1
fi
onpar_pm2_validate_runtime "${SERVICE_DIR}" "${UID}"
if [ "${TARGET_REF}" = "origin/main" ]; then
  git -C "${SOURCE_REPO}" fetch --prune origin main
fi
TARGET_SHA="$(git -C "${SOURCE_REPO}" rev-parse --verify "${TARGET_REF}^{commit}")"
if git -C "${SOURCE_REPO}" rev-parse --verify "origin/main^{commit}" >/dev/null 2>&1 \
  && ! git -C "${SOURCE_REPO}" merge-base --is-ancestor "${TARGET_SHA}" origin/main; then
  echo "Refusing to deploy ${TARGET_SHA}; it is not part of origin/main." >&2
  exit 1
fi

NODE_BIN="$(onpar_pm2_select_node22 "${SOURCE_REPO}" "${SERVICE_DIR}")"
NPM_BIN="$(onpar_pm2_find_npm "${NODE_BIN}")"
PM2_BIN="$(onpar_pm2_find_binary)"
CURRENT_INFO="$(onpar_pm2_app_info "${PM2_BIN}" "${NODE_BIN}" "${PM2_APP_NAME}" 2>/dev/null || true)"
IFS='|' read -r CURRENT_RELEASE CURRENT_STATUS CURRENT_ENV_SHA CURRENT_ENV_TIME <<< "${CURRENT_INFO}"
if [ -z "${CURRENT_RELEASE}" ] || [ "${CURRENT_STATUS}" != "online" ] || [ ! -d "${CURRENT_RELEASE}" ]; then
  echo "Existing PM2 app ${PM2_APP_NAME} must be online before guarded deployment." >&2
  exit 1
fi
case "${CURRENT_RELEASE}" in
  "${RELEASE_PARENT}/OnParBeverageRecipes-release-"*|"${SERVICE_DIR}") ;;
  *)
    echo "PM2 app ${PM2_APP_NAME} uses unexpected directory ${CURRENT_RELEASE}." >&2
    exit 1
    ;;
esac
CURRENT_SHA="$(onpar_pm2_release_sha "${SOURCE_REPO}" "${CURRENT_RELEASE}" || true)"
CURRENT_IDENTITY="$(onpar_pm2_release_identity "${CURRENT_RELEASE}" "${CURRENT_ENV_SHA}" || true)"

onpar_pm2_acquire_lock "${SERVICE_DIR}"
cleanup_lock() {
  onpar_pm2_release_lock "${ONPAR_PM2_LOCK_DIR}"
}
trap cleanup_lock EXIT

onpar_pm2_prepare_release \
  "${SOURCE_REPO}" "${SERVICE_DIR}" "${RELEASE_PARENT}" \
  "${TARGET_SHA}" "${NODE_BIN}" "${NPM_BIN}"
NEW_RELEASE="${ONPAR_PM2_PREPARED_RELEASE}"

if [ "${CURRENT_IDENTITY}" = "${TARGET_SHA}" ]; then
  onpar_pm2_smoke_release "${SMOKE_HELPER}" "${SOURCE_REPO}" "${CURRENT_RELEASE}" "${LOCAL_URL}" "${TARGET_SHA}"
  onpar_pm2_public_smoke "${NODE_BIN}" "${PUBLIC_URL}" "${TARGET_SHA}"
  onpar_pm2_activate_link "${SERVICE_DIR}" "${CURRENT_RELEASE}"
  onpar_pm2_install_helpers "${HELPER_DIR}" "${SERVICE_DIR}"
  printf '%s\n' "${TARGET_SHA}" > "${DEPLOY_DIR}/deployed-sha"
  chmod 600 "${DEPLOY_DIR}/deployed-sha"
  echo "${TARGET_SHA} is already deployed and healthy."
  exit 0
fi

SWITCHED=0
restore_previous_release() {
  local original_status=$?
  trap - ERR
  if [ "${SWITCHED}" -eq 1 ]; then
    echo "Deployment validation failed; restoring ${CURRENT_RELEASE}." >&2
    onpar_pm2_switch_release "${PM2_BIN}" "${NPM_BIN}" "${PM2_APP_NAME}" "${CURRENT_RELEASE}" "${CURRENT_IDENTITY}" "${CURRENT_ENV_TIME}" || true
    onpar_pm2_wait_for_release "${PM2_BIN}" "${NODE_BIN}" "${PM2_APP_NAME}" "${CURRENT_RELEASE}" || true
    onpar_pm2_smoke_release "${SMOKE_HELPER}" "${SOURCE_REPO}" "${CURRENT_RELEASE}" "${LOCAL_URL}" "${CURRENT_SHA}" || true
    onpar_pm2_public_smoke "${NODE_BIN}" "${PUBLIC_URL}" "${CURRENT_IDENTITY}" || true
  fi
  exit "${original_status}"
}
trap restore_previous_release ERR

SWITCHED=1
onpar_pm2_switch_release "${PM2_BIN}" "${NPM_BIN}" "${PM2_APP_NAME}" "${NEW_RELEASE}"
onpar_pm2_wait_for_release "${PM2_BIN}" "${NODE_BIN}" "${PM2_APP_NAME}" "${NEW_RELEASE}"
onpar_pm2_smoke_release "${SMOKE_HELPER}" "${SOURCE_REPO}" "${NEW_RELEASE}" "${LOCAL_URL}" "${TARGET_SHA}"
onpar_pm2_public_smoke "${NODE_BIN}" "${PUBLIC_URL}" "${TARGET_SHA}"
onpar_pm2_activate_link "${SERVICE_DIR}" "${NEW_RELEASE}"
onpar_pm2_install_helpers "${HELPER_DIR}" "${SERVICE_DIR}"

printf '%s\n' "${CURRENT_IDENTITY}" > "${DEPLOY_DIR}/previous-sha"
printf '%s\n' "${CURRENT_RELEASE}" > "${DEPLOY_DIR}/previous-release"
printf '%s\n' "${TARGET_SHA}" > "${DEPLOY_DIR}/deployed-sha"
chmod 600 "${DEPLOY_DIR}/previous-sha" "${DEPLOY_DIR}/previous-release" "${DEPLOY_DIR}/deployed-sha"
trap - ERR
echo "Deployed ${TARGET_SHA} through PM2. Previous release: ${CURRENT_RELEASE}."
