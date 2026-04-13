import nativeTargetsJson from "./native-targets.json"

export interface NativeTarget {
    key: string
    platform: NodeJS.Platform
    arch: string
    rustTarget: string
    exe: string
    os: string
    cpu: string
}

export const NATIVE_TARGETS = nativeTargetsJson as NativeTarget[]

export function findNativeTarget(platform: string, arch: string): NativeTarget | null {
    return NATIVE_TARGETS.find((target) => target.platform === platform && target.arch === arch) ?? null
}

export function formatNativeTargetKey(platform: string, arch: string): string {
    return `${platform}-${arch}`
}

export function optionalPlatformPackageName(target: NativeTarget): string {
    return `opencode-gateway-${target.key}`
}
