import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const scriptDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const repoRoot = NodePath.resolve(scriptDir, "..");

const env = { ...process.env };
let existingPath = "";
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === "path") {
    if (!existingPath && env[key]) {
      existingPath = env[key];
    }
    delete env[key];
  }
}

const binDir = NodePath.join(repoRoot, "node_modules", ".bin");
env.PATH = existingPath ? `${binDir}${NodePath.delimiter}${existingPath}` : binDir;
env.T3CODE_HOME = NodePath.join(repoRoot, ".t3-dev-home");
env.T3CODE_DEV_SEED = "0";
env.T3CODE_PORT_OFFSET = "417";
env.T3CODE_DISABLE_AUTO_UPDATE = "true";
env.T3CODE_DESKTOP_APP_USER_MODEL_ID = "com.t3tools.t3code.dev.antigravity-fork";

const child = NodeChildProcess.spawn(
  process.execPath,
  [NodePath.join(repoRoot, "scripts", "dev-runner.ts"), "dev:desktop", ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env,
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
