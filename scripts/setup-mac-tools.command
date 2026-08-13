#!/bin/bash
set -euo pipefail

PROJECT_DIR="${ONPAR_SERVICE_DIR:-/Users/onparmarketing/OnParBeverageRecipes-service}"
LAUNCH_AGENTS_DIR="/Users/onparmarketing/Library/LaunchAgents"
ACTIVE_LINK="${PROJECT_DIR}/current"

echo "On Par Beverage Recipes - Mac tool setup"
echo "Project: ${PROJECT_DIR}"
echo

if [ ! -d "${PROJECT_DIR}/.git" ]; then
  echo "The service checkout was not found at ${PROJECT_DIR}." >&2
  echo "Clone the repository there before running this setup." >&2
  exit 1
fi
# shellcheck source=scripts/release-common.sh
source "${PROJECT_DIR}/scripts/release-common.sh"

if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Homebrew already installed."
fi

if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

echo
echo "Installing required tools..."
brew update
brew install node@22 python git cloudflared

NODE22_PREFIX="$(brew --prefix node@22)"
export PATH="${NODE22_PREFIX}/bin:${PATH}"
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)" != "22" ]; then
  echo "Node.js 22 installation could not be selected from ${NODE22_PREFIX}." >&2
  exit 1
fi

echo
echo "Tool versions:"
node --version
npm --version
python3 --version
git --version
cloudflared --version

echo
echo "Installing project dependencies..."
cd "${PROJECT_DIR}"
npm ci

mkdir -p "${PROJECT_DIR}/logs" "${PROJECT_DIR}/data" "${PROJECT_DIR}/.deploy" "${LAUNCH_AGENTS_DIR}"
chmod 700 "${PROJECT_DIR}/logs" "${PROJECT_DIR}/data" "${PROJECT_DIR}/.deploy"

if [ ! -f "${PROJECT_DIR}/.env.local" ]; then
  cp "${PROJECT_DIR}/.env.local.example" "${PROJECT_DIR}/.env.local"
  chmod 600 "${PROJECT_DIR}/.env.local"
  echo
  echo "Created .env.local. Fill in its passwords, session secret, and service credentials before launch."
fi
onpar_validate_env_file "${PROJECT_DIR}/.env.local" "${UID}"

echo
echo "Running test and build checks..."
npm test
npm run lint
npm run build

echo
echo "Installing LaunchAgent definitions (not starting them yet)..."
for helper in \
  deploy-on-site.sh \
  release-common.sh \
  reload-launch-agents.sh \
  rollback-on-site.sh \
  run-dashboard.sh \
  run-par-agent.sh \
  smoke-on-site.sh; do
  install -m 700 "${PROJECT_DIR}/scripts/${helper}" "${PROJECT_DIR}/.deploy/${helper}"
done
if { [ -e "${ACTIVE_LINK}" ] || [ -L "${ACTIVE_LINK}" ]; } && [ ! -L "${ACTIVE_LINK}" ]; then
  echo "${ACTIVE_LINK} exists but is not a symlink; refusing to replace it." >&2
  exit 1
fi
if [ ! -L "${ACTIVE_LINK}" ]; then
  ln -s "${PROJECT_DIR}" "${ACTIVE_LINK}"
elif [ ! -d "${ACTIVE_LINK}" ]; then
  echo "${ACTIVE_LINK} is a broken symlink; repair it before installing services." >&2
  exit 1
fi
install -m 600 "${PROJECT_DIR}/scripts/com.onpar.dashboard.plist" "${LAUNCH_AGENTS_DIR}/com.onpar.beverage-dashboard.plist"
install -m 600 "${PROJECT_DIR}/scripts/com.onpar.par-agent.plist" "${LAUNCH_AGENTS_DIR}/com.onpar.par-agent.plist"

echo
echo "Setup checks passed. After .env.local is complete, start the services with:"
echo "  launchctl bootstrap gui/${UID} \"${LAUNCH_AGENTS_DIR}/com.onpar.beverage-dashboard.plist\""
echo "  launchctl bootstrap gui/${UID} \"${LAUNCH_AGENTS_DIR}/com.onpar.par-agent.plist\""
echo "Then validate with:"
echo "  \"${PROJECT_DIR}/.deploy/smoke-on-site.sh\""
echo
echo "Cloudflare tunnel installation is separate; keep its token/credentials out of this repository."
read -n 1 -s -r -p "Press any key to close this window..."
