import { expect, test } from "bun:test"

import { createDefaultOpencodeConfig, ensureGatewayPlugin, parseOpencodeConfig } from "./opencode-config"

test("ensureGatewayPlugin appends the package name once", () => {
    const unchanged = ensureGatewayPlugin({
        plugin: ["opencode-gateway"],
    })
    const changed = ensureGatewayPlugin({
        plugin: ["other-plugin"],
    })

    expect(unchanged.changed).toBe(false)
    expect(changed.changed).toBe(true)
    expect(changed.document.plugin).toEqual(["other-plugin", "opencode-gateway"])
})

test("ensureGatewayPlugin rejects a non-array plugin field", () => {
    expect(() =>
        ensureGatewayPlugin({
            plugin: "opencode-gateway",
        }),
    ).toThrow("must be an array")
})

test("createDefaultOpencodeConfig includes a managed server block only when requested", () => {
    expect(createDefaultOpencodeConfig(false)).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: ["opencode-gateway"],
    })
    expect(createDefaultOpencodeConfig(true)).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: ["opencode-gateway"],
        server: {
            hostname: "127.0.0.1",
            port: 4096,
        },
    })
})

test("parseOpencodeConfig requires a JSON object", () => {
    expect(() => parseOpencodeConfig("[]", "/tmp/opencode.json")).toThrow("must decode to a JSON object")
})
