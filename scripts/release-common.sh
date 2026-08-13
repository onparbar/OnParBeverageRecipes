#!/bin/bash

ONPAR_REQUIRED_NODE_MAJOR=22

onpar_select_node22() {
  local project_dir="$1"
  local candidate=""
  for candidate in \
    "${ONPAR_NODE_BIN:-}" \
    /opt/homebrew/opt/node@22/bin/node \
    /usr/local/opt/node@22/bin/node \
    "${project_dir}/.tools/node/bin/node" \
    "$(command -v node 2>/dev/null || true)"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ] \
      && [ "$("${candidate}" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)" = "${ONPAR_REQUIRED_NODE_MAJOR}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  echo "Node.js ${ONPAR_REQUIRED_NODE_MAJOR} was not found. Run scripts/setup-mac-tools.command first." >&2
  return 1
}

onpar_validate_env_file() {
  local env_file="$1"
  local expected_uid="${2:-${UID}}"
  local owner_uid=""
  local mode=""

  if [ ! -f "${env_file}" ] || [ -L "${env_file}" ]; then
    echo "${env_file} must be a regular, non-symlink file." >&2
    return 1
  fi
  owner_uid="$(stat -f '%u' "${env_file}" 2>/dev/null || stat -c '%u' "${env_file}" 2>/dev/null || true)"
  if [ "${owner_uid}" != "${expected_uid}" ]; then
    echo "${env_file} must be owned by service account UID ${expected_uid}; found ${owner_uid:-unknown}." >&2
    return 1
  fi
  chmod 600 "${env_file}"
  mode="$(stat -f '%Lp' "${env_file}" 2>/dev/null || stat -c '%a' "${env_file}" 2>/dev/null || true)"
  if [ "${mode}" != "600" ]; then
    echo "${env_file} must have mode 600; found ${mode:-unknown}." >&2
    return 1
  fi
}

onpar_source_checkout_changes() {
  local project_dir="$1"
  git -C "${project_dir}" status --porcelain --untracked-files=normal -- . \
    ':(exclude).deploy' \
    ':(exclude)current' \
    ':(exclude)data' \
    ':(exclude)logs' \
    ':(exclude)releases'
}

onpar_prepare_release() {
  local project_dir="$1"
  local target_sha="$2"
  local releases_dir="$3"
  local env_file="$4"
  local node_bin="$5"
  local release_dir="${releases_dir}/${target_sha}"
  local staging_dir="${releases_dir}/.staging-${target_sha}-$$"
  local npm_bin=""
  local built_at=""

  mkdir -p "${releases_dir}"
  chmod 700 "${releases_dir}"
  mkdir -p "${project_dir}/data" "${project_dir}/logs"
  chmod 700 "${project_dir}/data" "${project_dir}/logs"
  if [ -d "${release_dir}" ] && [ ! -L "${release_dir}" ] \
    && [ "$(sed -n '1p' "${release_dir}/.onpar-release-sha" 2>/dev/null || true)" = "${target_sha}" ] \
    && [ -f "${release_dir}/.next/BUILD_ID" ] \
    && [ -L "${release_dir}/.env.local" ] \
    && [ "$(readlink "${release_dir}/.env.local")" = "${env_file}" ] \
    && [ -L "${release_dir}/data" ] \
    && [ "$(readlink "${release_dir}/data")" = "${project_dir}/data" ] \
    && [ -L "${release_dir}/logs" ] \
    && [ "$(readlink "${release_dir}/logs")" = "${project_dir}/logs" ]; then
    ONPAR_PREPARED_RELEASE_DIR="${release_dir}"
    return 0
  fi
  if [ -e "${release_dir}" ] || [ -L "${release_dir}" ]; then
    echo "Release path exists but is not a complete ${target_sha} release: ${release_dir}." >&2
    return 1
  fi
  if [ -e "${staging_dir}" ] || [ -L "${staging_dir}" ]; then
    echo "Unexpected release staging path already exists: ${staging_dir}." >&2
    return 1
  fi
  mkdir -m 700 "${staging_dir}"

  if ! git -C "${project_dir}" archive "${target_sha}" | tar -x -C "${staging_dir}"; then
    case "${staging_dir}" in
      "${releases_dir}/.staging-${target_sha}-"*) rm -rf -- "${staging_dir}" ;;
    esac
    return 1
  fi
  if [ -e "${staging_dir}/data" ] || [ -L "${staging_dir}/data" ]; then
    echo "Target ${target_sha} unexpectedly contains a top-level data path; refusing to replace persistent runtime data." >&2
    case "${staging_dir}" in
      "${releases_dir}/.staging-${target_sha}-"*) rm -rf -- "${staging_dir}" ;;
    esac
    return 1
  fi
  ln -s "${env_file}" "${staging_dir}/.env.local"
  ln -s "${project_dir}/data" "${staging_dir}/data"
  ln -s "${project_dir}/logs" "${staging_dir}/logs"

  npm_bin="$(dirname "${node_bin}")/npm"
  if [ ! -x "${npm_bin}" ]; then
    npm_bin="$(command -v npm 2>/dev/null || true)"
  fi
  if [ -z "${npm_bin}" ] || [ ! -x "${npm_bin}" ]; then
    echo "npm from the Node.js 22 installation was not found." >&2
    case "${staging_dir}" in
      "${releases_dir}/.staging-${target_sha}-"*) rm -rf -- "${staging_dir}" ;;
    esac
    return 1
  fi

  if ! (
    cd "${staging_dir}"
    export PATH="$(dirname "${node_bin}"):${PATH}"
    "${npm_bin}" ci
    "${npm_bin}" test
    if git -C "${project_dir}" cat-file -e "${target_sha}:eslint.config.mjs" 2>/dev/null; then
      "${npm_bin}" run lint
    else
      echo "Legacy target ${target_sha} has no ESLint configuration; skipping the incompatible legacy lint command."
    fi
    ONPAR_BUILD_SHA="${target_sha}" ONPAR_DEPLOYMENT_TARGET="on-site" "${npm_bin}" run build
  ); then
    case "${staging_dir}" in
      "${releases_dir}/.staging-${target_sha}-"*) rm -rf -- "${staging_dir}" ;;
    esac
    return 1
  fi

  built_at="$(git -C "${project_dir}" show -s --format=%cI "${target_sha}")"
  printf '%s\n' "${target_sha}" > "${staging_dir}/.onpar-release-sha"
  printf '%s\n' "${built_at}" > "${staging_dir}/.onpar-build-timestamp"
  chmod 600 "${staging_dir}/.onpar-release-sha" "${staging_dir}/.onpar-build-timestamp"
  mv "${staging_dir}" "${release_dir}"
  ONPAR_PREPARED_RELEASE_DIR="${release_dir}"
}

onpar_activate_release() {
  local project_dir="$1"
  local release_dir="$2"
  local active_link="${project_dir}/current"
  local next_link="${project_dir}/.current-next-$$"

  if [ ! -d "${release_dir}" ] || [ -L "${release_dir}" ]; then
    echo "Refusing to activate an invalid release directory: ${release_dir}." >&2
    return 1
  fi
  if { [ -e "${active_link}" ] || [ -L "${active_link}" ]; } && [ ! -L "${active_link}" ]; then
    echo "Refusing to replace non-symlink active path ${active_link}." >&2
    return 1
  fi
  ln -s "${release_dir}" "${next_link}"
  if ! mv -f -h "${next_link}" "${active_link}"; then
    rm -f -- "${next_link}"
    return 1
  fi
}

onpar_find_launch_agent_plist() {
  local launch_agents_dir="$1"
  local expected_label="$2"
  local candidate=""
  local candidate_label=""
  local found=""

  for candidate in "${launch_agents_dir}"/*.plist; do
    [ -f "${candidate}" ] || continue
    candidate_label="$(plutil -extract Label raw -o - "${candidate}" 2>/dev/null || true)"
    [ "${candidate_label}" = "${expected_label}" ] || continue
    if [ -n "${found}" ]; then
      echo "Multiple LaunchAgent plists declare ${expected_label}; resolve them before deployment." >&2
      return 1
    fi
    found="${candidate}"
  done
  ONPAR_FOUND_LAUNCH_AGENT_PLIST="${found}"
}
