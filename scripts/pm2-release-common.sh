#!/bin/bash

ONPAR_REQUIRED_NODE_MAJOR=22

onpar_pm2_select_node22() {
  local source_repo="$1"
  local service_dir="$2"
  local candidate=""
  for candidate in \
    "${ONPAR_NODE_BIN:-}" \
    /opt/homebrew/opt/node@22/bin/node \
    /usr/local/opt/node@22/bin/node \
    "${service_dir}/.tools/node/bin/node" \
    "${source_repo}/.tools/node/bin/node" \
    "$(command -v node 2>/dev/null || true)"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ] \
      && [ "$("${candidate}" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)" = "${ONPAR_REQUIRED_NODE_MAJOR}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  echo "Node.js ${ONPAR_REQUIRED_NODE_MAJOR} was not found." >&2
  return 1
}

onpar_pm2_find_npm() {
  local node_bin="$1"
  local npm_bin="$(dirname "${node_bin}")/npm"
  if [ -x "${npm_bin}" ]; then
    printf '%s\n' "${npm_bin}"
    return 0
  fi
  npm_bin="$(command -v npm 2>/dev/null || true)"
  if [ -n "${npm_bin}" ] && [ -x "${npm_bin}" ]; then
    printf '%s\n' "${npm_bin}"
    return 0
  fi
  echo "npm was not found beside the Node.js 22 installation." >&2
  return 1
}

onpar_pm2_find_binary() {
  local candidate=""
  for candidate in \
    "${ONPAR_PM2_BIN:-}" \
    /opt/homebrew/bin/pm2 \
    /usr/local/bin/pm2 \
    "${HOME}/.npm-global/bin/pm2" \
    "$(command -v pm2 2>/dev/null || true)"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  echo "PM2 was not found for ${USER:-the service account}." >&2
  return 1
}

onpar_pm2_source_changes() {
  local source_repo="$1"
  git -C "${source_repo}" status --porcelain --untracked-files=normal -- .
}

onpar_pm2_validate_runtime() {
  local service_dir="$1"
  local expected_uid="${2:-${UID}}"
  local env_file="${service_dir}/.env.local"
  local owner_uid=""

  if [ ! -d "${service_dir}" ] || [ -L "${service_dir}" ]; then
    echo "${service_dir} must be the real persistent service directory." >&2
    return 1
  fi
  if [ -d "${service_dir}/.git" ]; then
    echo "${service_dir} unexpectedly contains Git metadata; source and runtime must remain separate." >&2
    return 1
  fi
  if [ ! -f "${env_file}" ] || [ -L "${env_file}" ]; then
    echo "${env_file} must be a regular, non-symlink file." >&2
    return 1
  fi
  owner_uid="$(stat -f '%u' "${env_file}" 2>/dev/null || true)"
  if [ "${owner_uid}" != "${expected_uid}" ]; then
    echo "${env_file} must be owned by service account UID ${expected_uid}." >&2
    return 1
  fi
  chmod 600 "${env_file}"
  for persistent_dir in data logs; do
    if [ ! -d "${service_dir}/${persistent_dir}" ] || [ -L "${service_dir}/${persistent_dir}" ]; then
      echo "${service_dir}/${persistent_dir} must be a real persistent directory." >&2
      return 1
    fi
  done
  mkdir -p "${service_dir}/.deploy"
  chmod 700 "${service_dir}/.deploy" "${service_dir}/data" "${service_dir}/logs"
}

onpar_pm2_release_path() {
  local release_parent="$1"
  local target_sha="$2"
  printf '%s/OnParBeverageRecipes-release-%s\n' "${release_parent}" "${target_sha}"
}

onpar_pm2_validate_release_path() {
  local release_parent="$1"
  local release_dir="$2"
  case "${release_dir}" in
    "${release_parent}/OnParBeverageRecipes-release-"*) ;;
    *)
      echo "Refusing unexpected release path ${release_dir}." >&2
      return 1
      ;;
  esac
  if [ ! -d "${release_dir}" ] || [ -L "${release_dir}" ]; then
    echo "Release path is not a real directory: ${release_dir}." >&2
    return 1
  fi
}

onpar_pm2_prepare_release() {
  local source_repo="$1"
  local service_dir="$2"
  local release_parent="$3"
  local target_sha="$4"
  local node_bin="$5"
  local npm_bin="$6"
  local release_dir=""
  local staging_dir=""
  local built_at=""

  release_dir="$(onpar_pm2_release_path "${release_parent}" "${target_sha}")"
  if [ -d "${release_dir}" ] && [ ! -L "${release_dir}" ] \
    && [ "$(sed -n '1p' "${release_dir}/.onpar-release-sha" 2>/dev/null || true)" = "${target_sha}" ] \
    && [ -f "${release_dir}/.next/BUILD_ID" ] \
    && [ -L "${release_dir}/.env.local" ] \
    && [ "$(readlink "${release_dir}/.env.local")" = "${service_dir}/.env.local" ] \
    && [ -L "${release_dir}/data" ] \
    && [ "$(readlink "${release_dir}/data")" = "${service_dir}/data" ] \
    && [ -L "${release_dir}/logs" ] \
    && [ "$(readlink "${release_dir}/logs")" = "${service_dir}/logs" ]; then
    ONPAR_PM2_PREPARED_RELEASE="${release_dir}"
    return 0
  fi
  if [ -e "${release_dir}" ] || [ -L "${release_dir}" ]; then
    echo "Release path exists but is not a complete ${target_sha} release: ${release_dir}." >&2
    return 1
  fi

  staging_dir="${release_parent}/.OnParBeverageRecipes-release-${target_sha}.staging-$$"
  if [ -e "${staging_dir}" ] || [ -L "${staging_dir}" ]; then
    echo "Unexpected release staging path already exists: ${staging_dir}." >&2
    return 1
  fi
  mkdir -m 700 "${staging_dir}"

  if ! git -C "${source_repo}" archive "${target_sha}" | tar -x -C "${staging_dir}"; then
    rm -rf -- "${staging_dir}"
    return 1
  fi
  for protected_path in .env.local data logs; do
    if [ -e "${staging_dir}/${protected_path}" ] || [ -L "${staging_dir}/${protected_path}" ]; then
      echo "Target ${target_sha} unexpectedly contains protected path ${protected_path}." >&2
      rm -rf -- "${staging_dir}"
      return 1
    fi
  done
  ln -s "${service_dir}/.env.local" "${staging_dir}/.env.local"
  ln -s "${service_dir}/data" "${staging_dir}/data"
  ln -s "${service_dir}/logs" "${staging_dir}/logs"

  if ! (
    cd "${staging_dir}"
    export PATH="$(dirname "${node_bin}"):${PATH}"
    "${npm_bin}" ci
    "${npm_bin}" test
    "${npm_bin}" run lint
    ONPAR_BUILD_SHA="${target_sha}" ONPAR_DEPLOYMENT_TARGET="on-site" "${npm_bin}" run build
  ); then
    rm -rf -- "${staging_dir}"
    return 1
  fi

  built_at="$(git -C "${source_repo}" show -s --format=%cI "${target_sha}")"
  printf '%s\n' "${target_sha}" > "${staging_dir}/.onpar-release-sha"
  printf '%s\n' "${built_at}" > "${staging_dir}/.onpar-build-timestamp"
  chmod 600 "${staging_dir}/.onpar-release-sha" "${staging_dir}/.onpar-build-timestamp"
  mv "${staging_dir}" "${release_dir}"
  ONPAR_PM2_PREPARED_RELEASE="${release_dir}"
}

onpar_pm2_app_info() {
  local pm2_bin="$1"
  local node_bin="$2"
  local app_name="$3"
  "${pm2_bin}" jlist 2>/dev/null | "${node_bin}" -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const name = process.argv[1];
  const matches = JSON.parse(input).filter((entry) => entry?.name === name);
  if (matches.length !== 1) process.exit(3);
  const env = matches[0].pm2_env || {};
  const sha = /^[a-f0-9]{7,64}$/i.test(String(env.ONPAR_BUILD_SHA || ""))
    ? String(env.ONPAR_BUILD_SHA).toLowerCase()
    : "";
  const builtAt = String(env.ONPAR_BUILD_TIMESTAMP || "").replace(/[|\r\n]/g, "");
  process.stdout.write(`${String(env.pm_cwd || "")}|${String(env.status || "")}|${sha}|${builtAt}\n`);
});
' "${app_name}"
}

onpar_pm2_release_sha() {
  local source_repo="$1"
  local release_dir="$2"
  local candidate=""
  if [ -f "${release_dir}/.onpar-release-sha" ]; then
    candidate="$(sed -n '1p' "${release_dir}/.onpar-release-sha")"
  else
    candidate="${release_dir##*/OnParBeverageRecipes-release-}"
  fi
  if [[ "${candidate}" =~ ^[a-fA-F0-9]{7,64}$ ]] \
    && git -C "${source_repo}" rev-parse --verify "${candidate}^{commit}" >/dev/null 2>&1; then
    git -C "${source_repo}" rev-parse --verify "${candidate}^{commit}"
  fi
}

onpar_pm2_release_identity() {
  local release_dir="$1"
  local environment_sha="${2:-}"
  local candidate="$(sed -n '1p' "${release_dir}/.onpar-release-sha" 2>/dev/null || true)"
  if ! [[ "${candidate}" =~ ^[a-fA-F0-9]{7,64}$ ]]; then
    candidate="${environment_sha}"
  fi
  if ! [[ "${candidate}" =~ ^[a-fA-F0-9]{7,64}$ ]]; then
    candidate="${release_dir##*/OnParBeverageRecipes-release-}"
  fi
  if [[ "${candidate}" =~ ^[a-fA-F0-9]{7,64}$ ]]; then
    printf '%s\n' "$(printf '%s' "${candidate}" | tr '[:upper:]' '[:lower:]')"
  fi
}

onpar_pm2_switch_release() {
  local pm2_bin="$1"
  local npm_bin="$2"
  local app_name="$3"
  local release_dir="$4"
  local release_sha="${5:-$(sed -n '1p' "${release_dir}/.onpar-release-sha" 2>/dev/null || true)}"
  local release_time="${6:-$(sed -n '1p' "${release_dir}/.onpar-build-timestamp" 2>/dev/null || true)}"
  local pm2_home="${PM2_HOME:-${HOME}/.pm2}"

  if ! [[ "${release_sha}" =~ ^[a-fA-F0-9]{7,64}$ ]]; then
    release_sha="$(onpar_pm2_release_identity "${release_dir}" "" || true)"
  fi

  if [ ! -f "${release_dir}/package.json" ] || [ ! -f "${release_dir}/.next/BUILD_ID" ]; then
    echo "Cannot start incomplete release ${release_dir}." >&2
    return 1
  fi
  "${pm2_bin}" delete "${app_name}" >/dev/null 2>&1 || true
  env -i \
    HOME="${HOME}" \
    USER="$(id -un)" \
    LOGNAME="$(id -un)" \
    PATH="${PATH}" \
    PM2_HOME="${pm2_home}" \
    NODE_ENV="production" \
    ONPAR_BUILD_SHA="${release_sha}" \
    ONPAR_BUILD_TIMESTAMP="${release_time}" \
    ONPAR_DEPLOYMENT_TARGET="on-site" \
    "${pm2_bin}" start "${npm_bin}" \
      --name "${app_name}" \
      --cwd "${release_dir}" \
      -- start -- -H 127.0.0.1 -p 3000
}

onpar_pm2_wait_for_release() {
  local pm2_bin="$1"
  local node_bin="$2"
  local app_name="$3"
  local expected_dir="$4"
  local info=""
  local running_dir=""
  local status=""
  for attempt in $(seq 1 15); do
    info="$(onpar_pm2_app_info "${pm2_bin}" "${node_bin}" "${app_name}" 2>/dev/null || true)"
    IFS='|' read -r running_dir status _ _ <<< "${info}"
    if [ "${running_dir}" = "${expected_dir}" ] && [ "${status}" = "online" ]; then
      return 0
    fi
    sleep 2
  done
  echo "PM2 did not bring ${app_name} online from ${expected_dir}." >&2
  return 1
}

onpar_pm2_activate_link() {
  local service_dir="$1"
  local release_dir="$2"
  local active_link="${service_dir}/current"
  local next_link="${service_dir}/.current-next-$$"
  if { [ -e "${active_link}" ] || [ -L "${active_link}" ]; } && [ ! -L "${active_link}" ]; then
    echo "Refusing to replace non-symlink active path ${active_link}." >&2
    return 1
  fi
  ln -s "${release_dir}" "${next_link}"
  mv -f -h "${next_link}" "${active_link}"
}

onpar_pm2_root_smoke() {
  local service_url="$1"
  local status=""
  for attempt in $(seq 1 15); do
    status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${service_url}/" 2>/dev/null || true)"
    case "${status}" in
      2??|3??) return 0 ;;
    esac
    sleep 2
  done
  echo "Dashboard at ${service_url} did not become reachable (last status ${status:-none})." >&2
  return 1
}

onpar_pm2_smoke_release() {
  local smoke_helper="$1"
  local source_repo="$2"
  local release_dir="$3"
  local service_url="$4"
  local release_sha="$5"
  if [ -n "${release_sha}" ]; then
    ONPAR_SOURCE_REPO="${source_repo}" \
    ONPAR_SERVICE_DIR="${release_dir}" \
    ONPAR_SERVICE_URL="${service_url}" \
      "${smoke_helper}" "${release_sha}"
  else
    onpar_pm2_root_smoke "${service_url}"
  fi
}

onpar_pm2_public_smoke() {
  local node_bin="$1"
  local service_url="$2"
  local expected_sha="$3"
  local probe="${expected_sha:-reachability}"
  local version_status=""
  local health_status=""
  local root_status=""
  local login_status=""
  local version_json=""
  local health_json=""
  local valid=0

  for attempt in $(seq 1 15); do
    version_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${service_url}/api/version?deploy=${probe}" 2>/dev/null || true)"
    health_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${service_url}/api/health?storage=1&deploy=${probe}" 2>/dev/null || true)"
    root_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${service_url}/?deploy=${probe}" 2>/dev/null || true)"
    login_status="$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "${service_url}/login?deploy=${probe}" 2>/dev/null || true)"
    valid=1
    case "${version_status}" in 200|401|403) ;; *) valid=0 ;; esac
    case "${health_status}" in 200|401|403) ;; *) valid=0 ;; esac
    case "${root_status}" in 2??|3??) ;; *) valid=0 ;; esac
    case "${login_status}" in 2??) ;; *) valid=0 ;; esac
    if [ "${valid}" -eq 1 ]; then
      break
    fi
    sleep 2
  done

  case "${version_status}" in
    200)
      version_json="$(curl --fail --silent --show-error --max-time 10 "${service_url}/api/version?deploy=${probe}")"
      "${node_bin}" -e '
const version = JSON.parse(process.argv[1]);
const expected = String(process.argv[2] || "").toLowerCase();
if (version.service !== "onpar-beverage-dashboard") throw new Error("Unexpected public service identity.");
if (expected && !String(version.commit || "").toLowerCase().startsWith(expected)) {
  throw new Error(`Public commit ${version.commit || "unknown"} does not match ${expected}.`);
}
' "${version_json}" "${expected_sha}"
      ;;
    401|403) ;;
    *) echo "Public version boundary returned HTTP ${version_status:-none}." >&2; return 1 ;;
  esac

  case "${health_status}" in
    200)
      health_json="$(curl --fail --silent --show-error --max-time 10 "${service_url}/api/health?storage=1&deploy=${probe}")"
      "${node_bin}" -e '
const health = JSON.parse(process.argv[1]);
if (health.ok !== true) throw new Error(`Public health failed with ${health.status || "unknown"}.`);
' "${health_json}"
      ;;
    401|403) ;;
    *) echo "Public health boundary returned HTTP ${health_status:-none}." >&2; return 1 ;;
  esac
  case "${root_status}" in 2??|3??) ;; *) echo "Public root returned HTTP ${root_status:-none}." >&2; return 1 ;; esac
  case "${login_status}" in 2??) ;; *) echo "Public login returned HTTP ${login_status:-none}." >&2; return 1 ;; esac

  printf '{"ok":true,"mode":"public-auth-boundary","versionStatus":%s,"healthStatus":%s,"rootStatus":%s,"loginStatus":%s}\n' \
    "${version_status}" "${health_status}" "${root_status}" "${login_status}"
}

onpar_pm2_acquire_lock() {
  local service_dir="$1"
  local lock_dir="${service_dir}/.deploy/pm2-deploy.lock"
  if ! mkdir "${lock_dir}" 2>/dev/null; then
    echo "Another PM2 deployment or rollback is already running." >&2
    return 1
  fi
  printf '%s\n' "$$" > "${lock_dir}/pid"
  chmod 700 "${lock_dir}"
  ONPAR_PM2_LOCK_DIR="${lock_dir}"
}

onpar_pm2_release_lock() {
  local lock_dir="$1"
  case "${lock_dir}" in
    */.deploy/pm2-deploy.lock) rm -rf -- "${lock_dir}" ;;
    *) echo "Refusing to remove unexpected deployment lock ${lock_dir}." >&2 ;;
  esac
}

onpar_pm2_install_helpers() {
  local helper_dir="$1"
  local service_dir="$2"
  local deploy_dir="${service_dir}/.deploy"
  local helper=""
  mkdir -p "${deploy_dir}"
  chmod 700 "${deploy_dir}"
  for helper in deploy-on-site-pm2.sh pm2-release-common.sh rollback-on-site-pm2.sh run-par-agent.sh smoke-on-site.sh; do
    if [ ! -f "${helper_dir}/${helper}" ]; then
      echo "Required PM2 helper is missing: ${helper_dir}/${helper}." >&2
      return 1
    fi
    if { [ -e "${deploy_dir}/${helper}" ] || [ -L "${deploy_dir}/${helper}" ]; } \
      && { [ ! -f "${deploy_dir}/${helper}" ] || [ -L "${deploy_dir}/${helper}" ]; }; then
      echo "Stable helper path is not a regular file: ${deploy_dir}/${helper}." >&2
      return 1
    fi
    install -m 700 "${helper_dir}/${helper}" "${deploy_dir}/${helper}"
  done
}
