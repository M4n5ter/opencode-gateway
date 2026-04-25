import type { BindingLoggerHost } from "../binding"
import type { GatewayHttpProxyConfig } from "../config/gateway"

export type GatewayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type ProxyEnv = {
    httpProxy: string | null
    httpsProxy: string | null
    noProxy: string | null
}

type EnvSource = Record<string, string | undefined>

type ExtendedRequestInit = RequestInit & {
    dispatcher?: unknown
    proxy?: string
}

type UndiciModule = {
    EnvHttpProxyAgent: new (options: { httpProxy?: string; httpsProxy?: string; noProxy?: string }) => unknown
}

type NoProxyRule =
    | { kind: "all" }
    | { kind: "host"; value: string }
    | { kind: "suffix"; value: string }
    | { kind: "hostPort"; value: string }

export async function createGatewayFetch(
    config: GatewayHttpProxyConfig,
    env: EnvSource,
    logger: Pick<BindingLoggerHost, "log">,
): Promise<GatewayFetch> {
    if (!config.enabled) {
        logger.log("debug", "gateway HTTP proxy support is disabled")
        return fetch
    }

    const proxyEnv = readProxyEnv(env)
    if (!hasProxyEnv(proxyEnv)) {
        logger.log("debug", "gateway HTTP proxy support is enabled but no proxy environment variables are configured")
        return fetch
    }

    if (isBunRuntime()) {
        logger.log("debug", "gateway HTTP proxy support is configured for Bun fetch")
        return createBunProxyFetch(proxyEnv, fetch)
    }

    const undici = await import("undici")
    const agent = createEnvHttpProxyAgent(undici, proxyEnv)
    logger.log("debug", "gateway HTTP proxy support is configured for Node fetch")
    return createNodeProxyFetch(agent, fetch)
}

export function readProxyEnv(env: EnvSource): ProxyEnv {
    return {
        httpProxy: readProxyValue(env.http_proxy) ?? readProxyValue(env.HTTP_PROXY),
        httpsProxy: readProxyValue(env.https_proxy) ?? readProxyValue(env.HTTPS_PROXY),
        noProxy: readProxyValue(env.no_proxy) ?? readProxyValue(env.NO_PROXY),
    }
}

export function hasProxyEnv(env: ProxyEnv): boolean {
    return env.httpProxy !== null || env.httpsProxy !== null
}

export function shouldBypassProxy(input: string | URL | Request, noProxy: string | null): boolean {
    const url = urlForInput(input)
    if (url === null) {
        return false
    }

    return noProxyRulesMatch(compileNoProxyRules(noProxy), url)
}

export function proxyForUrl(input: string | URL | Request, env: ProxyEnv): string | null {
    const url = urlForInput(input)
    if (url === null) {
        return null
    }

    return proxyForParsedUrl(url, env, compileNoProxyRules(env.noProxy))
}

export function createNodeProxyFetch(dispatcher: unknown, baseFetch: GatewayFetch): GatewayFetch {
    return async (input, init) =>
        await baseFetch(input, {
            ...init,
            dispatcher,
        } as ExtendedRequestInit)
}

export function createBunProxyFetch(proxyEnv: ProxyEnv, baseFetch: GatewayFetch): GatewayFetch {
    const noProxyRules = compileNoProxyRules(proxyEnv.noProxy)

    return async (input, init) => {
        const url = urlForInput(input)
        const proxy = url === null ? null : proxyForParsedUrl(url, proxyEnv, noProxyRules)
        if (proxy === null) {
            return await baseFetch(input, init)
        }

        return await baseFetch(input, {
            ...init,
            proxy,
        } as ExtendedRequestInit)
    }
}

function proxyForParsedUrl(url: URL, env: ProxyEnv, noProxyRules: NoProxyRule[]): string | null {
    if (noProxyRulesMatch(noProxyRules, url)) {
        return null
    }

    if (url.protocol === "http:") {
        return env.httpProxy
    }

    if (url.protocol === "https:") {
        return env.httpsProxy ?? env.httpProxy
    }

    return null
}

function createEnvHttpProxyAgent(undici: UndiciModule, env: ProxyEnv): unknown {
    return new undici.EnvHttpProxyAgent({
        httpProxy: env.httpProxy ?? undefined,
        httpsProxy: env.httpsProxy ?? undefined,
        noProxy: env.noProxy ?? undefined,
    })
}

function compileNoProxyRules(noProxy: string | null): NoProxyRule[] {
    if (noProxy === null) {
        return []
    }

    return noProxy
        .split(/[,\s]+/u)
        .map((rule) => normalizeNoProxyRule(rule))
        .filter((rule) => rule !== null)
}

function normalizeNoProxyRule(rule: string): NoProxyRule | null {
    const normalized = normalizeHost(rule)
    if (normalized.length === 0) {
        return null
    }

    if (normalized === "*") {
        return { kind: "all" }
    }

    if (normalized.includes(":")) {
        return { kind: "hostPort", value: normalized }
    }

    if (normalized.startsWith("*.")) {
        return { kind: "suffix", value: normalized.slice(1) }
    }

    if (normalized.startsWith(".")) {
        return { kind: "suffix", value: normalized }
    }

    return { kind: "host", value: normalized }
}

function noProxyRulesMatch(rules: NoProxyRule[], url: URL): boolean {
    const host = normalizeHost(url.hostname)
    const hostWithPort = `${host}:${effectivePort(url)}`

    return rules.some((rule) => noProxyRuleMatches(rule, host, hostWithPort))
}

function readProxyValue(value: string | undefined): string | null {
    const normalized = value?.trim()
    return normalized === undefined || normalized.length === 0 ? null : normalized
}

function isBunRuntime(): boolean {
    return "Bun" in globalThis
}

function urlForInput(input: string | URL | Request): URL | null {
    try {
        if (input instanceof URL) {
            return input
        }

        if (typeof input === "string") {
            return new URL(input)
        }

        return new URL(input.url)
    } catch {
        return null
    }
}

function noProxyRuleMatches(rule: NoProxyRule, host: string, hostWithPort: string): boolean {
    switch (rule.kind) {
        case "all":
            return true
        case "host":
            return host === rule.value
        case "suffix":
            return host === rule.value.slice(1) || host.endsWith(rule.value)
        case "hostPort":
            return hostWithPort === rule.value
    }
}

function normalizeHost(value: string): string {
    return value.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "")
}

function effectivePort(url: URL): string {
    if (url.port.length > 0) {
        return url.port
    }

    return url.protocol === "https:" ? "443" : "80"
}
