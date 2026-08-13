#!/bin/bash
set -Eeuo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onparmarketing/OnParBeverageRecipes-service}"
LAUNCH_AGENTS_DIR="${ONPAR_LAUNCH_AGENTS_DIR:-/Users/onparmarketing/Library/LaunchAgents}"
SOURCE_DIR="${ONPAR_LAUNCH_AGENT_SOURCE_DIR:-${PROJECT_DIR}/current/scripts}"
SERVICE_SELECTION="${1:-all}"
DOMAIN="gui/${UID}"
TEMP_ROOT="${TMPDIR:-/tmp}"
TEMP_ROOT="${TEMP_ROOT%/}"

case "${SERVICE_SELECTION}" in
  dashboard|par-agent|all) ;;
  *)
    echo "Usage: $0 [dashboard|par-agent|all]" >&2
    exit 2
    ;;
esac

mkdir -p "${LAUNCH_AGENTS_DIR}"
BACKUP_DIR="$(mktemp -d "${TEMP_ROOT}/onpar-launch-agent.XXXXXX")"
chmod 700 "${BACKUP_DIR}"

cleanup_backups() {
  case "${BACKUP_DIR}" in
    "${TEMP_ROOT}/"onpar-launch-agent.*)
      rm -rf -- "${BACKUP_DIR}"
      ;;
    *)
      echo "Refusing to remove unexpected LaunchAgent backup path ${BACKUP_DIR}." >&2
      ;;
  esac
}
trap cleanup_backups EXIT

reload_agent() {
  local source_plist="$1"
  local installed_name="$2"
  local expected_label="$3"
  local installed_plist="${LAUNCH_AGENTS_DIR}/${installed_name}"
  local backup_plist="${BACKUP_DIR}/${installed_name}"
  local had_installed=0
  local was_loaded=0
  local actual_label=""

  if [ ! -f "${source_plist}" ]; then
    echo "LaunchAgent source is missing: ${source_plist}" >&2
    return 1
  fi
  plutil -lint "${source_plist}" >/dev/null
  actual_label="$(plutil -extract Label raw -o - "${source_plist}")"
  if [ "${actual_label}" != "${expected_label}" ]; then
    echo "LaunchAgent ${source_plist} has label ${actual_label}, expected ${expected_label}." >&2
    return 1
  fi

  if [ -e "${installed_plist}" ] && [ ! -f "${installed_plist}" ]; then
    echo "Installed LaunchAgent path is not a regular file: ${installed_plist}" >&2
    return 1
  fi
  if [ -f "${installed_plist}" ]; then
    cp -p "${installed_plist}" "${backup_plist}"
    had_installed=1
  fi
  if launchctl print "${DOMAIN}/${expected_label}" >/dev/null 2>&1; then
    was_loaded=1
    echo "Stopping ${expected_label} before replacing its plist..."
    launchctl bootout "${DOMAIN}/${expected_label}"
  fi

  install -m 600 "${source_plist}" "${installed_plist}"
  echo "Starting ${expected_label} from ${installed_plist}..."
  if launchctl bootstrap "${DOMAIN}" "${installed_plist}" \
    && launchctl print "${DOMAIN}/${expected_label}" >/dev/null; then
    echo "Reloaded ${expected_label}."
    return 0
  fi

  echo "The updated ${expected_label} plist did not load; restoring the prior definition." >&2
  if [ "${had_installed}" -eq 1 ]; then
    install -m 600 "${backup_plist}" "${installed_plist}"
    if [ "${was_loaded}" -eq 1 ]; then
      launchctl bootstrap "${DOMAIN}" "${installed_plist}" || true
    fi
  else
    rm -f -- "${installed_plist}"
  fi
  return 1
}

if [ "${SERVICE_SELECTION}" = "dashboard" ] || [ "${SERVICE_SELECTION}" = "all" ]; then
  reload_agent \
    "${SOURCE_DIR}/com.onpar.dashboard.plist" \
    "com.onpar.beverage-dashboard.plist" \
    "com.onpar.beverage-dashboard"
fi

if [ "${SERVICE_SELECTION}" = "par-agent" ] || [ "${SERVICE_SELECTION}" = "all" ]; then
  reload_agent \
    "${SOURCE_DIR}/com.onpar.par-agent.plist" \
    "com.onpar.par-agent.plist" \
    "com.onpar.par-agent"
fi

if { [ "${SERVICE_SELECTION}" = "dashboard" ] || [ "${SERVICE_SELECTION}" = "all" ]; } \
  && [ "${ONPAR_SKIP_LAUNCH_AGENT_SMOKE:-0}" != "1" ]; then
  "${ONPAR_SMOKE_SCRIPT:-${PROJECT_DIR}/.deploy/smoke-on-site.sh}"
fi
