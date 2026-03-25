import { expect, test } from "bun:test"

import { resolveServerOriginFromDocument } from "./opencode-server"

test("resolveServerOriginFromDocument falls back to the default origin", () => {
    expect(resolveServerOriginFromDocument({})).toBe("http://127.0.0.1:4096")
    expect(resolveServerOriginFromDocument({ server: { hostname: "", port: 4096 } })).toBe("http://127.0.0.1:4096")
})

test("resolveServerOriginFromDocument uses an explicit hostname and port", () => {
    expect(
        resolveServerOriginFromDocument({
            server: {
                hostname: "0.0.0.0",
                port: 7777,
            },
        }),
    ).toBe("http://0.0.0.0:7777")
})
