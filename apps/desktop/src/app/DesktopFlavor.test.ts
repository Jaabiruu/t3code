import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopCliShim from "./DesktopCliShim.ts";
import { resolveDesktopAppBranding, type DesktopEnvironment } from "./DesktopEnvironment.ts";
import { getDesktopFlavorProfile } from "./DesktopFlavor.ts";
import { resolveDesktopBaseDir, resolveDesktopStateDir } from "./DesktopStatePaths.ts";
import { resolveUserDataPath } from "./DesktopUserData.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

it("isolates paths, branding, protocol schemes, CLI shim, updates, and backend port for antigravity flavor", () => {
  const profile = getDesktopFlavorProfile("antigravity");
  assert.equal(profile.baseName, "T3 Code Antigravity");
  assert.equal(profile.defaultHomeDirName, ".t3-antigravity");
  assert.equal(profile.installCliOnFirstLaunch, false);
  assert.equal(profile.disableAutoUpdates, true);
  assert.equal(profile.defaultBackendPort, 3873);

  const baseDir = resolveDesktopBaseDir({
    homeDirectory: "C:\\Users\\alice",
    joinPath: (...parts) => parts.join("\\"),
    t3Home: Option.none(),
    flavor: "antigravity",
  });
  assert.equal(baseDir, "C:\\Users\\alice\\.t3-antigravity");

  const stateDir = resolveDesktopStateDir({
    baseDir,
    isDevelopment: false,
    joinPath: (...parts) => parts.join("\\"),
    t3Home: Option.none(),
  });
  assert.equal(stateDir, "C:\\Users\\alice\\.t3-antigravity\\userdata");

  const prodBranding = resolveDesktopAppBranding({
    isDevelopment: false,
    appVersion: "0.1.11",
    flavor: "antigravity",
  });
  assert.equal(prodBranding.displayName, "T3 Code Antigravity");

  assert.equal(ElectronProtocol.getDesktopScheme(false, "antigravity"), "t3code-ag");
  assert.equal(ElectronProtocol.getDesktopScheme(true, "antigravity"), "t3code-ag-dev");

  const shimPath = DesktopCliShim.launcherPath({
    flavor: "antigravity",
    baseDir,
    platform: "win32",
    path: {
      join: (...parts: string[]) => parts.join("\\"),
    },
  } as unknown as DesktopEnvironment["Service"]);
  assert.equal(shimPath, "C:\\Users\\alice\\.t3-antigravity\\bin\\t3-ag.cmd");
});

it.effect("antigravity flavor userData path never inspects or copies legacy T3 Code profiles", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appData = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ag-userdata-" });
    const alphaDir = path.join(appData, "T3 Code (Alpha)");
    const v1Dir = path.join(appData, "t3code");
    yield* fs.makeDirectory(alphaDir, { recursive: true });
    yield* fs.makeDirectory(v1Dir, { recursive: true });
    yield* fs.writeFileString(path.join(alphaDir, "Local State"), "legacy-alpha");
    yield* fs.writeFileString(path.join(v1Dir, "Local State"), "legacy-v1");

    const prodPath = yield* resolveUserDataPath({
      appDataDirectory: appData,
      isDevelopment: false,
      platform: "win32",
      flavor: "antigravity",
    });
    assert.equal(prodPath, path.join(appData, "t3code-antigravity"));
    assert.isFalse(yield* fs.exists(path.join(prodPath, "Local State")));

    const devDir = path.join(appData, "T3 Code (Dev)");
    yield* fs.makeDirectory(devDir, { recursive: true });
    const devPath = yield* resolveUserDataPath({
      appDataDirectory: appData,
      isDevelopment: true,
      platform: "win32",
      flavor: "antigravity",
    });
    assert.equal(devPath, path.join(appData, "t3code-antigravity-dev"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
