import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectDir = process.cwd();
const shellScripts = [
  "scripts/bootstrap-deploy-on-site.sh",
  "scripts/deploy-on-site.sh",
  "scripts/reload-launch-agents.sh",
  "scripts/release-common.sh",
  "scripts/rollback-on-site.sh",
  "scripts/run-dashboard.sh",
  "scripts/run-par-agent.sh",
  "scripts/install-par-agent-daemon.sh",
  "scripts/setup-mac-tools.command",
  "scripts/smoke-on-site.sh",
];

test("release shell scripts pass bash syntax validation", () => {
  shellScripts.forEach((script) => {
    const result = spawnSync("bash", ["-n", script], {
      cwd: projectDir,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  });
});

test("the par agent follows the checked release through the Node 22 helper", async () => {
  const workflow = await readFile(".github/workflows/deploy-on-site.yml", "utf8");
  const common = await readFile("scripts/pm2-release-common.sh", "utf8");
  const daemon = await readFile("scripts/com.onpar.par-agent.daemon.plist", "utf8");
  assert.match(workflow, /scripts\/run-par-agent\.sh/);
  assert.match(common, /run-par-agent\.sh/);
  assert.match(daemon, /<string>onpar<\/string>/);
  assert.match(daemon, /OnParBeverageRecipes-service\/.deploy\/run-par-agent\.sh/);
  assert.match(daemon, /OnParBeverageRecipes-service\/current/);
  assert.match(daemon, /<string>--dry-run<\/string>/);
});

test("smoke checks are legacy-compatible only when both modern endpoints are absent", async () => {
  const source = await readFile("scripts/smoke-on-site.sh", "utf8");
  assert.match(source, /cat-file -e .*app\/api\/version\/route\.js/);
  assert.match(source, /cat-file -e .*app\/api\/health\/route\.js/);
  assert.match(source, /HAS_VERSION_ENDPOINT.*-ne.*HAS_HEALTH_ENDPOINT/s);
  assert.match(source, /mode\":\"legacy-root/);
  assert.match(source, /version\.service !== "onpar-beverage-dashboard"/);
  assert.match(source, /version\.commit !== expected\.toLowerCase\(\)/);
  assert.match(source, /health\.ok !== true/);
  assert.match(source, /HEALTH_SUFFIX="\?storage=1"/);
  assert.match(source, /HEALTH_SUFFIX="\?storage=1&deep=1"/);
});

test("bootstrap extracts reviewed helpers without switching the old checkout first", async () => {
  const source = await readFile("scripts/bootstrap-deploy-on-site.sh", "utf8");
  const archiveIndex = source.indexOf("git archive");
  const deployIndex = source.indexOf('"${BOOTSTRAP_DIR}/scripts/deploy-on-site.sh"');
  assert.ok(archiveIndex > 0);
  assert.ok(deployIndex > archiveIndex);
  assert.match(source, /git status --porcelain --untracked-files=normal/);
  assert.match(source, /git rev-parse --verify/);
  assert.match(source, /scripts\/release-common\.sh/);
});

test("production runtime and release wrappers require Node.js 22", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const nodeVersion = (await readFile(".node-version", "utf8")).trim();
  const runtime = await readFile("scripts/run-dashboard.sh", "utf8");
  const deploy = await readFile("scripts/deploy-on-site.sh", "utf8");
  const rollback = await readFile("scripts/rollback-on-site.sh", "utf8");
  const common = await readFile("scripts/release-common.sh", "utf8");

  assert.equal(packageJson.engines.node, ">=22 <23");
  assert.equal(nodeVersion, "22");
  [runtime, common].forEach((source) => {
    assert.match(source, /process\.versions\.node\.split\("\."\)\[0\]/);
    assert.match(source, /Node\.js 22/);
  });
  [deploy, rollback].forEach((source) => {
    assert.match(source, /source "\$\{DEPLOY_HELPER_DIR\}\/release-common\.sh"/);
    assert.match(source, /onpar_select_node22/);
  });
});

test("release staging preserves secrets and runtime data outside immutable releases", async () => {
  const common = await readFile("scripts/release-common.sh", "utf8");
  const deploy = await readFile("scripts/deploy-on-site.sh", "utf8");
  const setup = await readFile("scripts/setup-mac-tools.command", "utf8");
  const gitignore = await readFile(".gitignore", "utf8");

  assert.match(common, /ln -s "\$\{env_file\}" "\$\{staging_dir\}\/\.env\.local"/);
  assert.match(common, /ln -s "\$\{project_dir\}\/data" "\$\{staging_dir\}\/data"/);
  assert.match(common, /\.onpar-release-sha/);
  assert.match(deploy, /onpar_activate_release/);
  assert.match(deploy, /reload-launch-agents\.sh" all/);
  assert.match(setup, /ln -s "\$\{PROJECT_DIR\}" "\$\{ACTIVE_LINK\}"/);
  assert.match(gitignore, /^current$/m);
  assert.match(gitignore, /^releases\/$/m);
});

test("environment file is validated as private on setup, deploy, and rollback", async () => {
  const common = await readFile("scripts/release-common.sh", "utf8");
  const scripts = await Promise.all([
    readFile("scripts/setup-mac-tools.command", "utf8"),
    readFile("scripts/deploy-on-site.sh", "utf8"),
    readFile("scripts/rollback-on-site.sh", "utf8"),
  ]);

  assert.match(common, /\[ ! -f "\$\{env_file\}" \] \|\| \[ -L "\$\{env_file\}" \]/);
  assert.match(common, /chmod 600 "\$\{env_file\}"/);
  scripts.forEach((source) => assert.match(source, /onpar_validate_env_file/));
});

test("LaunchAgent reload validates labels and uses bootout plus bootstrap", async () => {
  const source = await readFile("scripts/reload-launch-agents.sh", "utf8");
  assert.match(source, /plutil -lint/);
  assert.match(source, /plutil -extract Label raw/);
  assert.match(source, /launchctl bootout/);
  assert.match(source, /launchctl bootstrap/);
  assert.match(source, /restoring the prior definition/);
});

test("deploy migrates and can restore both durable service definitions", async () => {
  const deploy = await readFile("scripts/deploy-on-site.sh", "utf8");
  const rollback = await readFile("scripts/rollback-on-site.sh", "utf8");

  assert.match(deploy, /com\.onpar\.beverage-dashboard/);
  assert.match(deploy, /com\.onpar\.par-agent/);
  assert.match(deploy, /dashboard-plist\.before-deploy/);
  assert.match(deploy, /par-agent-plist\.before-deploy/);
  assert.match(deploy, /reload-launch-agents\.sh" all/);
  assert.match(rollback, /kickstart -k "gui\/\$\{UID\}\/\$\{SERVICE_LABEL\}"/);
  assert.match(rollback, /kickstart -k "gui\/\$\{UID\}\/com\.onpar\.par-agent"/);
  assert.doesNotMatch(rollback, /ONPAR_LAUNCH_AGENT_SOURCE_DIR="\$\{TARGET_RELEASE\}/);
});
