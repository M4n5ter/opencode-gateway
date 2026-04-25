import { expect, test } from "bun:test"

import {
    createBunProxyFetch,
    createNodeProxyFetch,
    type GatewayFetch,
    hasProxyEnv,
    proxyForUrl,
    readProxyEnv,
    shouldBypassProxy,
} from "./proxy"

test("readProxyEnv prefers lowercase values and ignores blanks", () => {
    const env = readProxyEnv({
        http_proxy: " http://lowercase:8080 ",
        HTTP_PROXY: "http://uppercase:8080",
        https_proxy: " ",
        HTTPS_PROXY: "https://secure:8443",
        no_proxy: " api.telegram.org ",
        NO_PROXY: "*",
    })

    expect(env).toEqual({
        httpProxy: "http://lowercase:8080",
        httpsProxy: "https://secure:8443",
        noProxy: "api.telegram.org",
    })
    expect(hasProxyEnv(env)).toBe(true)
})

test("hasProxyEnv requires an HTTP or HTTPS proxy", () => {
    expect(
        hasProxyEnv({
            httpProxy: null,
            httpsProxy: null,
            noProxy: "localhost",
        }),
    ).toBe(false)
})

test("shouldBypassProxy supports wildcard, exact hosts, suffixes, and host ports", () => {
    expect(shouldBypassProxy("https://api.telegram.org/bot", "*")).toBe(true)
    expect(shouldBypassProxy("https://api.telegram.org/bot", "api.telegram.org")).toBe(true)
    expect(shouldBypassProxy("https://api.telegram.org/bot", ".telegram.org")).toBe(true)
    expect(shouldBypassProxy("https://api.telegram.org:9443/bot", "api.telegram.org:9443")).toBe(true)
    expect(shouldBypassProxy("https://api.telegram.org/bot", "example.com")).toBe(false)
})

test("proxyForUrl chooses scheme proxy and respects no_proxy", () => {
    const env = {
        httpProxy: "http://proxy:8080",
        httpsProxy: "http://secure-proxy:8443",
        noProxy: "api.telegram.org",
    }

    expect(proxyForUrl("https://example.com", env)).toBe("http://secure-proxy:8443")
    expect(proxyForUrl("http://example.com", env)).toBe("http://proxy:8080")
    expect(proxyForUrl("https://api.telegram.org", env)).toBeNull()
})

test("proxyForUrl uses HTTP proxy as HTTPS fallback but not the reverse", () => {
    expect(
        proxyForUrl("https://example.com", {
            httpProxy: "http://proxy:8080",
            httpsProxy: null,
            noProxy: null,
        }),
    ).toBe("http://proxy:8080")
    expect(
        proxyForUrl("http://example.com", {
            httpProxy: null,
            httpsProxy: "http://secure-proxy:8443",
            noProxy: null,
        }),
    ).toBeNull()
})

test("createNodeProxyFetch delegates proxy selection to the dispatcher", async () => {
    const calls: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = []
    const baseFetch: GatewayFetch = async (input, init) => {
        calls.push({ input, init })
        return new Response(JSON.stringify({ ok: true, result: [] }))
    }
    const dispatcher = { kind: "dispatcher" }
    const gatewayFetch = createNodeProxyFetch(dispatcher, baseFetch)

    await gatewayFetch("https://example.com")
    await gatewayFetch("https://api.telegram.org")

    expect(calls[0].init).toMatchObject({ dispatcher })
    expect(calls[1].init).toMatchObject({ dispatcher })
})

test("createBunProxyFetch attaches proxy only for proxied requests", async () => {
    const calls: Array<{ input: string | URL | Request; init: RequestInit | undefined }> = []
    const baseFetch: GatewayFetch = async (input, init) => {
        calls.push({ input, init })
        return new Response(JSON.stringify({ ok: true, result: [] }))
    }
    const gatewayFetch = createBunProxyFetch(
        {
            httpProxy: null,
            httpsProxy: "http://secure-proxy:8443",
            noProxy: "api.telegram.org",
        },
        baseFetch,
    )

    await gatewayFetch("https://example.com", { method: "POST" })
    await gatewayFetch("https://api.telegram.org", { method: "POST" })

    expect(calls[0].init).toMatchObject({ method: "POST", proxy: "http://secure-proxy:8443" })
    expect(calls[1].init).toEqual({ method: "POST" })
})
