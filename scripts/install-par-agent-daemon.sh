#!/bin/bash
set -Eeuo pipefail

LABEL="com.onpar.par-agent"
SOURCE_PLIST="${ONPAR_PAR_AGENT_PLIST:-/Users/onpar/OnParBeverageRecipes-service/current/scripts/com.onpar.par-agent.daemon.plist}"
TARGET_PLIST="/Library/LaunchDaemons/com.onpar.par-agent.plist"
TEMP_ROOT="${TMPDIR:-/private/tmp}"
TEMP_ROOT="${TEMP_ROOT%/}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This guarded service repair requires administrator approval." >&2
  exit 1
fi
if [ ! -f "${SOURCE_PLIST}" ] || [ -L "${SOURCE_PLIST}" ]; then
  echo "The checked par-agent service definition is missing: ${SOURCE_PLIST}" >&2
  exit 1
fi
if [ -e "${TARGET_PLIST}" ] && { [ ! -f "${TARGET_PLIST}" ] || [ -L "${TARGET_PLIST}" ]; }; then
  echo "Refusing to replace an unexpected LaunchDaemon path: ${TARGET_PLIST}" >&2
  exit 1
fi
plutil -lint "${SOURCE_PLIST}" >/dev/null
if [ "$(plutil -extract Label raw -o - "${SOURCE_PLIST}")" != "${LABEL}" ]; then
  echo "The checked service definition has the wrong label." >&2
  exit 1
fi

BACKUP_DIR="$(mktemp -d "${TEMP_ROOT}/onpar-par-agent.XXXXXX")"
chmod 700 "${BACKUP_DIR}"
BACKUP_PLIST="${BACKUP_DIR}/com.onpar.par-agent.plist"
HAD_INSTALLED=0
WAS_LOADED=0
if [ -f "${TARGET_PLIST}" ]; then
  cp -p "${TARGET_PLIST}" "${BACKUP_PLIST}"
  HAD_INSTALLED=1
fi
if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
  WAS_LOADED=1
fi

cleanup() {
  case "${BACKUP_DIR}" in
    "${TEMP_ROOT}/"onpar-par-agent.*) rm -rf -- "${BACKUP_DIR}" ;;
    *) echo "Refusing to remove unexpected backup path ${BACKUP_DIR}." >&2 ;;
  esac
}
restore() {
  local status=$?
  trap - ERR
  launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
  if [ "${HAD_INSTALLED}" -eq 1 ]; then
    install -o root -g wheel -m 644 "${BACKUP_PLIST}" "${TARGET_PLIST}"
    if [ "${WAS_LOADED}" -eq 1 ]; then launchctl bootstrap system "${TARGET_PLIST}" || true; fi
  else
    rm -f -- "${TARGET_PLIST}"
  fi
  exit "${status}"
}
trap cleanup EXIT
trap restore ERR

launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
install -o root -g wheel -m 644 "${SOURCE_PLIST}" "${TARGET_PLIST}"
launchctl bootstrap system "${TARGET_PLIST}"
launchctl print "system/${LABEL}" >/dev/null
trap - ERR
echo "Installed ${LABEL} through the checked release helper. The agent was not run immediately."
