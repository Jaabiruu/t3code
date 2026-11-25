export type DesktopFlavor = "default" | "antigravity";

declare const __T3CODE_DESKTOP_FLAVOR__: string | undefined;

export const BUILD_DESKTOP_FLAVOR: DesktopFlavor =
  typeof __T3CODE_DESKTOP_FLAVOR__ === "string" && __T3CODE_DESKTOP_FLAVOR__ === "antigravity"
    ? "antigravity"
    : "default";

export interface DesktopFlavorProfile {
  readonly flavor: DesktopFlavor;
  readonly baseName: string;
  readonly defaultHomeDirName: string;
  readonly userDataDirProd: string;
  readonly userDataDirDev: string;
  readonly legacyUserDataDirDev: string | null;
  readonly migrateLegacyProfiles: boolean;
  readonly appUserModelIdProd: string;
  readonly appUserModelIdDev: string;
  readonly linuxDesktopEntryProd: string;
  readonly linuxDesktopEntryDev: string;
  readonly protocolSchemeProd: string;
  readonly protocolSchemeDev: string;
  readonly cliCommandName: string;
  readonly cliShimMarker: string;
  readonly installCliOnFirstLaunch: boolean;
  readonly defaultBackendPort: number;
  readonly disableAutoUpdates: boolean;
}

const DEFAULT_DESKTOP_FLAVOR_PROFILE: DesktopFlavorProfile = {
  flavor: "default",
  baseName: "T3 Code",
  defaultHomeDirName: ".t3",
  userDataDirProd: "t3code-v2",
  userDataDirDev: "t3code-dev",
  legacyUserDataDirDev: "T3 Code (Dev)",
  migrateLegacyProfiles: true,
  appUserModelIdProd: "com.t3tools.t3code",
  appUserModelIdDev: "com.t3tools.t3code.dev",
  linuxDesktopEntryProd: "com.t3tools.T3Code.desktop",
  linuxDesktopEntryDev: "com.t3tools.T3Code.Development.desktop",
  protocolSchemeProd: "t3code",
  protocolSchemeDev: "t3code-dev",
  cliCommandName: "t3",
  cliShimMarker: "Written by T3 Code: runs the desktop app's bundled t3 CLI.",
  installCliOnFirstLaunch: true,
  defaultBackendPort: 3773,
  disableAutoUpdates: false,
};

const ANTIGRAVITY_DESKTOP_FLAVOR_PROFILE: DesktopFlavorProfile = {
  flavor: "antigravity",
  baseName: "T3 Code Antigravity",
  defaultHomeDirName: ".t3-antigravity",
  userDataDirProd: "t3code-antigravity",
  userDataDirDev: "t3code-antigravity-dev",
  legacyUserDataDirDev: null,
  migrateLegacyProfiles: false,
  appUserModelIdProd: "com.jaabiruu.t3code.antigravity",
  appUserModelIdDev: "com.jaabiruu.t3code.antigravity.dev",
  linuxDesktopEntryProd: "com.jaabiruu.T3CodeAntigravity.desktop",
  linuxDesktopEntryDev: "com.jaabiruu.T3CodeAntigravity.Development.desktop",
  protocolSchemeProd: "t3code-ag",
  protocolSchemeDev: "t3code-ag-dev",
  cliCommandName: "t3-ag",
  cliShimMarker: "Written by T3 Code Antigravity: runs the desktop app's bundled t3-ag CLI.",
  installCliOnFirstLaunch: false,
  defaultBackendPort: 3873,
  disableAutoUpdates: true,
};

export function getDesktopFlavorProfile(
  flavor: DesktopFlavor = BUILD_DESKTOP_FLAVOR,
): DesktopFlavorProfile {
  return flavor === "antigravity"
    ? ANTIGRAVITY_DESKTOP_FLAVOR_PROFILE
    : DEFAULT_DESKTOP_FLAVOR_PROFILE;
}
