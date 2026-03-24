import { expect, test } from "bun:test"

import {
    createDefaultOpencodeConfig,
    ensureGatewayPlugin,
    inspectGatewayPlugin,
    parseOpencodeConfig,
} from "./opencode-config"

test("ensureGatewayPlugin appends the package spec once without clearing existing plugins", () => {
    const unchanged = ensureGatewayPlugin({
        plugin: ["other-plugin", "opencode-gateway@latest"],
    })
    const changed = ensureGatewayPlugin({
        plugin: ["other-plugin", "./plugins/opencode-gateway.ts"],
    })

    expect(unchanged.changed).toBe(false)
    expect(changed.changed).toBe(true)
    expect(changed.document.plugin).toEqual([
        "other-plugin",
        "./plugins/opencode-gateway.ts",
        "opencode-gateway@latest",
    ])
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
        plugin: ["opencode-gateway@latest"],
    })
    expect(createDefaultOpencodeConfig(true)).toEqual({
        $schema: "https://opencode.ai/config.json",
        plugin: ["opencode-gateway@latest"],
        server: {
            hostname: "127.0.0.1",
            port: 4096,
        },
    })
})

test("parseOpencodeConfig accepts jsonc comments and trailing commas", () => {
    const parsed = parseOpencodeConfig(
        `{
          // comment
          "plugin": [
            "opencode-gateway@latest",
          ],
        }`,
        "/tmp/opencode.jsonc",
    )

    expect(parsed).toEqual({
        plugin: ["opencode-gateway@latest"],
    })
})

test("parseOpencodeConfig requires a JSON object", () => {
    expect(() => parseOpencodeConfig("[]", "/tmp/opencode.json")).toThrow("must decode to a JSON object")
})

test("inspectGatewayPlugin reports when a gateway entry still needs normalization", () => {
    expect(
        inspectGatewayPlugin({
            plugin: ["opencode-gateway"],
        }),
    ).toBe("needs_update")
    expect(
        inspectGatewayPlugin({
            plugin: ["opencode-gateway@latest"],
        }),
    ).toBe("yes")
})
