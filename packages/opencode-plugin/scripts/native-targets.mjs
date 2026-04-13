import nativeTargets from "../src/cli/native-targets.json" with { type: "json" }

export const NATIVE_TARGETS = nativeTargets

export function findNativeTarget(platform, arch) {
    return NATIVE_TARGETS.find((target) => target.platform === platform && target.arch === arch) ?? null
}

export function hostNativeTarget() {
    const target = findNativeTarget(process.platform, process.arch)
    if (target === null) {
        throw new Error(`unsupported host platform/arch: ${process.platform}-${process.arch}`)
    }

    return target
}

export function optionalPlatformPackageName(target) {
    return `opencode-gateway-${target.key}`
}

export function platformPackageVersion(baseVersion, target) {
    return `${baseVersion}-${target.key}`
}

export function platformDistTag(tag, target) {
    if (tag === null || tag === "latest") {
        return target.key
    }

    return `${tag}-${target.key}`
}
