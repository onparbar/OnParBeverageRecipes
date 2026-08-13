#!/bin/bash
set -Eeuo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onparmarketing/OnParBeverageRecipes-service}"
SERVICE_LABEL="${ONPAR_LAUNCHD_LABEL:-com.onpar.beverage-dashboard}"
ROLLBACK_FILE="${PROJECT_DIR}/.deploy/previous-sha"
PREVIOUS_RELEASE_FILE="${PROJECT_DIR}/.deploy/previous-release"
TARGET_REF="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_HELPER_DIR="${ONPAR_DEPLOY_HELPER_DIR:-${SCRIPT_DIR}}"
RELEASES_DIR="${PROJECT_DIR}/releases"
ACTIVE_LINK="${PROJECT_DIR}/current"
ENV_FILE="${PROJECT_DIR}/.env.local"
DEPLOY_DIR="${PROJECT_DIR}/.deploy"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:${PROJECT_DIR}/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ ! -d "${PROJECT_DIR}/.git" ]; then
  echo "${PROJECT_DIR} is not the dashboard Git checkout." >&2
  exit 1
fi
if [ ! -f "${DEPLOY_HELPER_DIR}/release-common.sh" ] \
  || [ ! -f "${DEPLOY_HELPER_DIR}/run-dashboard.sh" ] \
  || [ ! -f "${DEPLOY_HELPER_DIR}/run-par-agent.sh" ] \
  || [ ! -f "${DEPLOY_HELPER_DIR}/smoke-on-site.sh" ]; then
  echo "Rollback helpers are incomplete in ${DEPLOY_HELPER_DIR}." >&2
  exit 1
fi
# shellcheck source=scripts/release-common.sh
source "${DEPLOY_HELPER_DIR}/release-common.sh"

cd "${PROJECT_DIR}"
if [ -n "$(onpar_source_checkout_changes "${PROJECT_DIR}")" ]; then
  echo "Rollback stopped because the service checkout has uncommitted files." >&2
  exit 1
fi
NODE_BIN="$(onpar_select_node22 "${PROJECT_DIR}")"
onpar_validate_env_file "${ENV_FILE}" "${UID}"

CURRENT_RELEASE=""
if [ -L "${ACTIVE_LINK}" ]; then
  CURRENT_RELEASE="$(readlink "${ACTIVE_LINK}")"
  case "${CURRENT_RELEASE}" in
    /*) ;;
    *) CURRENT_RELEASE="${PROJECT_DIR}/${CURRENT_RELEASE}" ;;
  esac
fi
CURRENT_SHA="$(git rev-parse --verify HEAD)"
if [ -n "${CURRENT_RELEASE}" ] && [ -f "${CURRENT_RELEASE}/.onpar-release-sha" ]; then
  CURRENT_SHA="$(sed -n '1p' "${CURRENT_RELEASE}/.onpar-release-sha")"
fi

TARGET_RELEASE=""
TARGET_SHA=""
if [ -z "${TARGET_REF}" ]; then
  if [ -f "${PREVIOUS_RELEASE_FILE}" ]; then
    TARGET_RELEASE="$(sed -n '1p' "${PREVIOUS_RELEASE_FILE}")"
  fi
  if [ -n "${TARGET_RELEASE}" ] && [ -d "${TARGET_RELEASE}" ]; then
    if [ -f "${TARGET_RELEASE}/.onpar-release-sha" ]; then
      TARGET_SHA="$(sed -n '1p' "${TARGET_RELEASE}/.onpar-release-sha")"
    elif [ -f "${ROLLBACK_FILE}" ]; then
      TARGET_SHA="$(sed -n '1p' "${ROLLBACK_FILE}")"
    else
      echo "The recorded rollback path has no release metadata or matching commit record." >&2
      exit 1
    fi
  else
    if [ ! -f "${ROLLBACK_FILE}" ]; then
      echo "No recorded rollback release exists. Pass a commit SHA explicitly." >&2
      exit 1
    fi
    TARGET_REF="$(sed -n '1p' "${ROLLBACK_FILE}")"
  fi
fi

if [ -n "${TARGET_REF}" ]; then
  TARGET_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}")"
  onpar_prepare_release "${PROJECT_DIR}" "${TARGET_SHA}" "${RELEASES_DIR}" "${ENV_FILE}" "${NODE_BIN}"
  TARGET_RELEASE="${ONPAR_PREPARED_RELEASE_DIR}"
elif [ "${TARGET_RELEASE}" != "${PROJECT_DIR}" ]; then
  onpar_prepare_release "${PROJECT_DIR}" "${TARGET_SHA}" "${RELEASES_DIR}" "${ENV_FILE}" "${NODE_BIN}"
  TARGET_RELEASE="${ONPAR_PREPARED_RELEASE_DIR}"
fi

mkdir -p "${DEPLOY_DIR}"
chmod 700 "${DEPLOY_DIR}"

ACTIVATED=0
recover_failed_rollback() {
  local original_status=$?
  trap - ERR
  if [ "${ACTIVATED}" -eq 1 ] && [ -n "${CURRENT_RELEASE}" ] && [ -d "${CURRENT_RELEASE}" ]; then
    echo "Rollback validation failed; atomically restoring ${CURRENT_SHA}." >&2
    onpar_activate_release "${PROJECT_DIR}" "${CURRENT_RELEASE}" || true
    launchctl kickstart -k "gui/${UID}/${SERVICE_LABEL}" || true
    launchctl kickstart -k "gui/${UID}/com.onpar.par-agent" || true
    ONPAR_SOURCE_REPO="${PROJECT_DIR}" ONPAR_SERVICE_DIR="${CURRENT_RELEASE}" \
      "${DEPLOY_DIR}/smoke-on-site.sh" "${CURRENT_SHA}" || true
  fi
  exit "${original_status}"
}
trap recover_failed_rollback ERR

onpar_activate_release "${PROJECT_DIR}" "${TARGET_RELEASE}"
ACTIVATED=1
launchctl kickstart -k "gui/${UID}/${SERVICE_LABEL}"
launchctl kickstart -k "gui/${UID}/com.onpar.par-agent"
ONPAR_SOURCE_REPO="${PROJECT_DIR}" ONPAR_SERVICE_DIR="${TARGET_RELEASE}" \
  "${DEPLOY_DIR}/smoke-on-site.sh" "${TARGET_SHA}"

printf '%s\n' "${CURRENT_SHA}" > "${ROLLBACK_FILE}"
printf '%s\n' "${CURRENT_RELEASE}" > "${PREVIOUS_RELEASE_FILE}"
chmod 600 "${ROLLBACK_FILE}" "${PREVIOUS_RELEASE_FILE}"
trap - ERR
echo "Rolled back atomically to ${TARGET_SHA}. The prior running commit was ${CURRENT_SHA}."
