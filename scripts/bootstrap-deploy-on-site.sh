#!/bin/bash
set -Eeuo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onparmarketing/OnParBeverageRecipes-service}"
TARGET_REF="${1:-origin/main}"
TEMP_ROOT="${TMPDIR:-/tmp}"
TEMP_ROOT="${TEMP_ROOT%/}"
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:${PROJECT_DIR}/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [ ! -d "${PROJECT_DIR}/.git" ]; then
  echo "${PROJECT_DIR} is not the dashboard Git checkout." >&2
  exit 1
fi

cd "${PROJECT_DIR}"
SOURCE_CHANGES="$(git status --porcelain --untracked-files=normal -- . \
  ':(exclude).deploy' \
  ':(exclude)current' \
  ':(exclude)data' \
  ':(exclude)logs' \
  ':(exclude)releases')"
if [ -n "${SOURCE_CHANGES}" ]; then
  echo "Bootstrap deployment stopped because the service checkout has uncommitted files." >&2
  exit 1
fi

if [ "${TARGET_REF}" = "origin/main" ]; then
  git fetch --prune origin main
fi

TARGET_SHA="$(git rev-parse --verify "${TARGET_REF}^{commit}")"
for helper_path in \
  scripts/deploy-on-site.sh \
  scripts/release-common.sh \
  scripts/reload-launch-agents.sh \
  scripts/rollback-on-site.sh \
  scripts/run-dashboard.sh \
  scripts/run-par-agent.sh \
  scripts/smoke-on-site.sh; do
  if ! git cat-file -e "${TARGET_SHA}:${helper_path}" 2>/dev/null; then
    echo "Target ${TARGET_SHA} does not contain ${helper_path}; bootstrap cannot continue." >&2
    exit 1
  fi
done

BOOTSTRAP_DIR="$(mktemp -d "${TEMP_ROOT}/onpar-deploy-bootstrap.XXXXXX")"
chmod 700 "${BOOTSTRAP_DIR}"

cleanup_bootstrap() {
  case "${BOOTSTRAP_DIR}" in
    "${TEMP_ROOT}/"onpar-deploy-bootstrap.*)
      rm -rf -- "${BOOTSTRAP_DIR}"
      ;;
    *)
      echo "Refusing to remove unexpected bootstrap path ${BOOTSTRAP_DIR}." >&2
      ;;
  esac
}
trap cleanup_bootstrap EXIT

git archive "${TARGET_SHA}" -- \
  scripts/deploy-on-site.sh \
  scripts/release-common.sh \
  scripts/reload-launch-agents.sh \
  scripts/rollback-on-site.sh \
  scripts/run-dashboard.sh \
  scripts/run-par-agent.sh \
  scripts/smoke-on-site.sh \
  | tar -x -C "${BOOTSTRAP_DIR}"
chmod 700 \
  "${BOOTSTRAP_DIR}/scripts/deploy-on-site.sh" \
  "${BOOTSTRAP_DIR}/scripts/reload-launch-agents.sh" \
  "${BOOTSTRAP_DIR}/scripts/rollback-on-site.sh" \
  "${BOOTSTRAP_DIR}/scripts/run-dashboard.sh" \
  "${BOOTSTRAP_DIR}/scripts/run-par-agent.sh" \
  "${BOOTSTRAP_DIR}/scripts/smoke-on-site.sh"

echo "Bootstrapped deployment helpers from ${TARGET_SHA}; starting the normal guarded deployment."
ONPAR_DEPLOY_HELPER_DIR="${BOOTSTRAP_DIR}/scripts" \
  "${BOOTSTRAP_DIR}/scripts/deploy-on-site.sh" "${TARGET_SHA}"
