import { expect, test } from "bun:test"

import { resolveNativeLauncher } from "./native-launcher"

test("resolveNativeLauncher prefers the installed platform package", () => {
    const resolved = resolveNativeLauncher("/repo/packages/opencode-plugin", "linux", "x64", (packageName) =>
        packageName === "opencode-gateway-linux-x64" ? "/tmp/node_modules/opencode-gateway-linux-x64/package.json" : null,
    )

    expect(resolved).toEqual({
        target: expect.objectContaining({
            key: "linux-x64",
            exe: "opencode-gateway-launcher",
        }),
        path: "/tmp/node_modules/opencode-gateway-linux-x64/vendor/linux-x64/opencode-gateway-launcher",
        source: "optional-package",
    })
})

test("resolveNativeLauncher falls back to the local build output", () => {
    const resolved = resolveNativeLauncher("/repo/packages/opencode-plugin", "darwin", "arm64", () => null)

    expect(resolved).toEqual({
        target: expect.objectContaining({
            key: "darwin-arm64",
            exe: "opencode-gateway-launcher",
        }),
        path: "/repo/packages/opencode-plugin/dist/native/darwin-arm64/opencode-gateway-launcher",
        source: "local-build",
    })
})

test("resolveNativeLauncher rejects unsupported platform/arch pairs", () => {
    expect(() => resolveNativeLauncher("/repo/packages/opencode-plugin", "linux", "ppc64", () => null)).toThrow(
        "unsupported platform/arch: linux-ppc64",
    )
})
