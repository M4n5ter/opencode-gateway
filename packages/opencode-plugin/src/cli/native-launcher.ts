import { dirname, join } from "node:path"

import {
    findNativeTarget,
    formatNativeTargetKey,
    type NativeTarget,
    optionalPlatformPackageName,
} from "./native-targets"

export interface NativeLauncherResolution {
    target: NativeTarget
    path: string
    source: "optional-package" | "local-build"
}

export function resolveNativeLauncher(
    packageRoot: string,
    platform: string,
    arch: string,
    resolveInstalledPackageJson: (packageName: string) => string | null,
): NativeLauncherResolution {
    const target = findNativeTarget(platform, arch)
    if (target === null) {
        throw new Error(`unsupported platform/arch: ${formatNativeTargetKey(platform, arch)}`)
    }

    const installedManifest = resolveInstalledPackageJson(optionalPlatformPackageName(target))
    if (installedManifest !== null) {
        return {
            target,
            path: join(dirname(installedManifest), "vendor", target.key, target.exe),
            source: "optional-package",
        }
    }

    return {
        target,
        path: join(packageRoot, "dist", "native", target.key, target.exe),
        source: "local-build",
    }
}
