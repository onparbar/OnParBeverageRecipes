#!/bin/bash
set -Eeuo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onpar/OnParBeverageRecipes-service}"
TARGET_REF="${1:-origin/main}"
SERVICE_LABEL="${ONPAR_LAUNCHD_LABEL:-com.onpar.beverage-dashboard}"
PAR_AGENT_LABEL="${ONPAR_PAR_AGENT_LAUNCHD_LABEL:-com.onpar.par-agent}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_HELPER_DIR="${ONPAR_DEPLOY_HELPER_DIR:-${SCRIPT_DIR}}"
LAUNCH_AGENTS_DIR="${ONPAR_LAUNCH_AGENTS_DIR:-/Users/onpar/Library/LaunchAgents}"
RELEASES_DIR="${PROJECT_DIR}/releases"
ACTIVE_LINK="${PROJECT_DIR}/current"
ENV_FILE="${PROJECT_DIR}/.env.local"
DEPLOY_DIR="${PROJECT_DIR}/.deploy"
TEMP_ROOT="${TMPDIR:-/tmp}"
TEMP_ROOT="${TEMP_ROOT%/}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:${PROJECT_DIR}/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ ! -d "${PROJECT_DIR}/.git" ]; then
  echo "${PROJECT_DIR} is not the dashboard Git checkout." >&2
  exit 1
fi
for helper in release-common.sh reload-launch-agents.sh run-dashboard.sh run-par-agent.sh smoke-on-site.sh; do
  if [ ! -f "${DEPLOY_HELPER_DIR}/${helper}" ]; then
    echo "Deployment helper is missing: ${DEPLOY_HELPER_DIR}/${helper}." >&2
    exit 1
  fi
done
# shellcheck source=scripts/release-common.sh
source "${DEPLOY_HELPER_DIR}/release-common.sh"

cd "${PROJECT_DIR}"
if [ -n "$(onpar_source_checkout_changes "${PROJECT_DIR}")" ]; then
  echo "Deployment stopped because the service checkout has uncommitted files." >&2
  exit 1
fi
NODE_BIN="$(onpar_select_node22 "${PROJECT_DIR}")"
onpar_validate_env_file "${ENV_FILE}" "${UID}"

mkdir -p "${PROJECT_DIR}/logs" "${DEPLOY_DIR}" "${LAUNCH_AGENTS_DIR}"
chmod 700 "${PROJECT_DIR}/logs" "${DEPLOY_DIR}"

if [ "${TARGET_REF}" = "origin/main" ]; then
  git fetch --prune origin main
fi
TARGET_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}")"
PREVIOUS_SHA="$(git rev-parse --verify HEAD)"
PREVIOUS_RELEASE=""
if [ -L "${ACTIVE_LINK}" ]; then
  PREVIOUS_RELEASE="$(readlink "${ACTIVE_LINK}")"
  case "${PREVIOUS_RELEASE}" in
    /*) ;;
    *) PREVIOUS_RELEASE="${PROJECT_DIR}/${PREVIOUS_RELEASE}" ;;
  esac
  if [ -f "${PREVIOUS_RELEASE}/.onpar-release-sha" ]; then
    PREVIOUS_SHA="$(sed -n '1p' "${PREVIOUS_RELEASE}/.onpar-release-sha")"
  fi
fi

onpar_prepare_release "${PROJECT_DIR}" "${TARGET_SHA}" "${RELEASES_DIR}" "${ENV_FILE}" "${NODE_BIN}"
RELEASE_DIR="${ONPAR_PREPARED_RELEASE_DIR}"
STABLE_HELPERS="deploy-on-site.sh release-common.sh reload-launch-agents.sh rollback-on-site.sh run-dashboard.sh run-par-agent.sh smoke-on-site.sh"
for helper in ${STABLE_HELPERS}; do
  if [ ! -f "${RELEASE_DIR}/scripts/${helper}" ]; then
    echo "Target ${TARGET_SHA} is missing required release helper scripts/${helper}." >&2
    exit 1
  fi
done
for plist in com.onpar.dashboard.plist com.onpar.par-agent.plist; do
  if [ ! -f "${RELEASE_DIR}/scripts/${plist}" ]; then
    echo "Target ${TARGET_SHA} is missing required service definition scripts/${plist}." >&2
    exit 1
  fi
done

onpar_find_launch_agent_plist "${LAUNCH_AGENTS_DIR}" "${SERVICE_LABEL}"
PREVIOUS_PLIST="${ONPAR_FOUND_LAUNCH_AGENT_PLIST}"
INSTALLED_PLIST="${LAUNCH_AGENTS_DIR}/com.onpar.beverage-dashboard.plist"
onpar_find_launch_agent_plist "${LAUNCH_AGENTS_DIR}" "${PAR_AGENT_LABEL}"
PREVIOUS_PAR_PLIST="${ONPAR_FOUND_LAUNCH_AGENT_PLIST}"
INSTALLED_PAR_PLIST="${LAUNCH_AGENTS_DIR}/com.onpar.par-agent.plist"
BACKUP_DIR="$(mktemp -d "${TEMP_ROOT}/onpar-deploy-backup.XXXXXX")"
chmod 700 "${BACKUP_DIR}"
cleanup_deploy_backup() {
  case "${BACKUP_DIR}" in
    "${TEMP_ROOT}/"onpar-deploy-backup.*) rm -rf -- "${BACKUP_DIR}" ;;
    *) echo "Refusing to remove unexpected deploy backup path ${BACKUP_DIR}." >&2 ;;
  esac
}
trap cleanup_deploy_backup EXIT
PLIST_BACKUP="${BACKUP_DIR}/dashboard-plist.before-deploy"
PAR_PLIST_BACKUP="${BACKUP_DIR}/par-agent-plist.before-deploy"
if [ -n "${PREVIOUS_PLIST}" ]; then
  cp -p "${PREVIOUS_PLIST}" "${PLIST_BACKUP}"
  chmod 600 "${PLIST_BACKUP}"
else
  : > "${PLIST_BACKUP}"
  chmod 600 "${PLIST_BACKUP}"
fi
if [ -n "${PREVIOUS_PAR_PLIST}" ]; then
  cp -p "${PREVIOUS_PAR_PLIST}" "${PAR_PLIST_BACKUP}"
  chmod 600 "${PAR_PLIST_BACKUP}"
else
  : > "${PAR_PLIST_BACKUP}"
  chmod 600 "${PAR_PLIST_BACKUP}"
fi

for helper in ${STABLE_HELPERS}; do
  if { [ -e "${DEPLOY_DIR}/${helper}" ] || [ -L "${DEPLOY_DIR}/${helper}" ]; } \
    && { [ ! -f "${DEPLOY_DIR}/${helper}" ] || [ -L "${DEPLOY_DIR}/${helper}" ]; }; then
    echo "Stable helper path is not a regular file: ${DEPLOY_DIR}/${helper}." >&2
    exit 1
  fi
  if [ -f "${DEPLOY_DIR}/${helper}" ]; then
    cp -p "${DEPLOY_DIR}/${helper}" "${BACKUP_DIR}/${helper}"
  fi
done

ACTIVATED=0
restore_stable_helpers() {
  local helper=""
  for helper in ${STABLE_HELPERS}; do
    if [ -f "${BACKUP_DIR}/${helper}" ]; then
      install_stable_helper "${BACKUP_DIR}/${helper}" "${helper}"
    else
      rm -f -- "${DEPLOY_DIR}/${helper}"
    fi
  done
}
install_stable_helper() {
  local source_path="$1"
  local helper_name="$2"
  local next_path="${DEPLOY_DIR}/.${helper_name}.next.$$"
  install -m 700 "${source_path}" "${next_path}"
  mv -f "${next_path}" "${DEPLOY_DIR}/${helper_name}"
}
rollback_failed_deploy() {
  local original_status=$?
  trap - ERR
  restore_stable_helpers || true
  if [ "${ACTIVATED}" -eq 1 ]; then
    if [ -n "${PREVIOUS_RELEASE}" ] && [ -d "${PREVIOUS_RELEASE}" ]; then
      echo "Deployment validation failed; atomically restoring ${PREVIOUS_SHA}." >&2
      onpar_activate_release "${PROJECT_DIR}" "${PREVIOUS_RELEASE}" || true
    else
      echo "First deployment validation failed; restoring the legacy service definition." >&2
      rm -f -- "${ACTIVE_LINK}"
    fi
    launchctl bootout "gui/${UID}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
    if [ -n "${PREVIOUS_PLIST}" ] && [ -s "${PLIST_BACKUP}" ]; then
      if [ "${PREVIOUS_PLIST}" != "${INSTALLED_PLIST}" ]; then
        rm -f -- "${INSTALLED_PLIST}"
      fi
      install -m 600 "${PLIST_BACKUP}" "${PREVIOUS_PLIST}"
      launchctl bootstrap "gui/${UID}" "${PREVIOUS_PLIST}" || true
    elif [ -z "${PREVIOUS_PLIST}" ]; then
      rm -f -- "${INSTALLED_PLIST}"
    fi
    launchctl bootout "gui/${UID}/${PAR_AGENT_LABEL}" >/dev/null 2>&1 || true
    if [ -n "${PREVIOUS_PAR_PLIST}" ] && [ -s "${PAR_PLIST_BACKUP}" ]; then
      if [ "${PREVIOUS_PAR_PLIST}" != "${INSTALLED_PAR_PLIST}" ]; then
        rm -f -- "${INSTALLED_PAR_PLIST}"
      fi
      install -m 600 "${PAR_PLIST_BACKUP}" "${PREVIOUS_PAR_PLIST}"
      launchctl bootstrap "gui/${UID}" "${PREVIOUS_PAR_PLIST}" || true
    elif [ -z "${PREVIOUS_PAR_PLIST}" ]; then
      rm -f -- "${INSTALLED_PAR_PLIST}"
    fi
    if [ -n "${PREVIOUS_RELEASE}" ] && [ -d "${PREVIOUS_RELEASE}" ]; then
      ONPAR_SOURCE_REPO="${PROJECT_DIR}" ONPAR_SERVICE_DIR="${PREVIOUS_RELEASE}" \
        "${DEPLOY_DIR}/smoke-on-site.sh" "${PREVIOUS_SHA}" || true
    fi
  else
    echo "Deployment failed before a release replaced the active service." >&2
  fi
  exit "${original_status}"
}
trap rollback_failed_deploy ERR

install -m 700 "${RELEASE_DIR}/scripts/run-dashboard.sh" "${DEPLOY_DIR}/run-dashboard.sh"
install -m 700 "${RELEASE_DIR}/scripts/run-par-agent.sh" "${DEPLOY_DIR}/run-par-agent.sh"
onpar_activate_release "${PROJECT_DIR}" "${RELEASE_DIR}"
ACTIVATED=1
ONPAR_SERVICE_DIR="${PROJECT_DIR}" \
ONPAR_LAUNCH_AGENT_SOURCE_DIR="${RELEASE_DIR}/scripts" \
ONPAR_SKIP_LAUNCH_AGENT_SMOKE=1 \
  "${RELEASE_DIR}/scripts/reload-launch-agents.sh" all
ONPAR_SOURCE_REPO="${PROJECT_DIR}" ONPAR_SERVICE_DIR="${RELEASE_DIR}" \
  "${RELEASE_DIR}/scripts/smoke-on-site.sh" "${TARGET_SHA}"
if [ -n "${PREVIOUS_PLIST}" ] && [ "${PREVIOUS_PLIST}" != "${INSTALLED_PLIST}" ]; then
  rm -f -- "${PREVIOUS_PLIST}"
fi
if [ -n "${PREVIOUS_PAR_PLIST}" ] && [ "${PREVIOUS_PAR_PLIST}" != "${INSTALLED_PAR_PLIST}" ]; then
  rm -f -- "${PREVIOUS_PAR_PLIST}"
fi
for helper in ${STABLE_HELPERS}; do
  install_stable_helper "${RELEASE_DIR}/scripts/${helper}" "${helper}"
done

printf '%s\n' "${PREVIOUS_SHA}" > "${DEPLOY_DIR}/previous-sha"
printf '%s\n' "${PREVIOUS_RELEASE}" > "${DEPLOY_DIR}/previous-release"
printf '%s\n' "${TARGET_SHA}" > "${DEPLOY_DIR}/deployed-sha"
chmod 600 "${DEPLOY_DIR}/previous-sha" "${DEPLOY_DIR}/previous-release" "${DEPLOY_DIR}/deployed-sha"
trap - ERR
echo "Deployed ${TARGET_SHA} atomically. Previous commit: ${PREVIOUS_SHA}."
