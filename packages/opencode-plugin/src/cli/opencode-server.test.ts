import { expect, test } from "bun:test"

import {
    parseLsofListenOutput,
    resolveServerEndpointFromDocument,
    resolveServerOriginFromDocument,
} from "./opencode-server"

test("resolveServerOriginFromDocument falls back to the default origin", () => {
    expect(resolveServerOriginFromDocument({})).toBe("http://127.0.0.1:4096")
    expect(resolveServerOriginFromDocument({ server: { hostname: "", port: 4096 } })).toBe("http://127.0.0.1:4096")
})

test("resolveServerEndpointFromDocument normalizes wildcard hosts for local warm calls", () => {
    expect(
        resolveServerEndpointFromDocument({
            server: {
                hostname: "0.0.0.0",
                port: 7777,
            },
        }),
    ).toEqual({
        host: "0.0.0.0",
        connectHost: "127.0.0.1",
        port: 7777,
        origin: "http://127.0.0.1:7777",
    })
})

test("resolveServerEndpointFromDocument lets CLI overrides replace config values", () => {
    expect(
        resolveServerEndpointFromDocument(
            {
                server: {
                    hostname: "127.0.0.1",
                    port: 4096,
                },
            },
            {
                serverHost: "localhost",
                serverPort: 9090,
            },
        ),
    ).toEqual({
        host: "localhost",
        connectHost: "localhost",
        port: 9090,
        origin: "http://localhost:9090",
    })
})

test("parseLsofListenOutput extracts a loopback listening endpoint", () => {
    expect(parseLsofListenOutput("p123\nf22\nn127.0.0.1:43123\n")).toEqual({
        host: "127.0.0.1",
        connectHost: "127.0.0.1",
        port: 43123,
        origin: "http://127.0.0.1:43123",
    })
})

test("parseLsofListenOutput normalizes wildcard listen addresses", () => {
    expect(parseLsofListenOutput("p123\nf22\nn*:43123\n")).toEqual({
        host: "*",
        connectHost: "127.0.0.1",
        port: 43123,
        origin: "http://127.0.0.1:43123",
    })
})
