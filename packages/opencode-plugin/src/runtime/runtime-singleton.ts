const RUNTIME_CACHE_KEY = Symbol.for("opencode-gateway.runtime-cache")

type RuntimeCache = Map<string, Promise<unknown>>

export function getOrCreateRuntimeSingleton<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const cache = getRuntimeCache()
    const existing = cache.get(key)
    if (existing !== undefined) {
        return existing as Promise<T>
    }

    const promise = factory().catch((error) => {
        if (cache.get(key) === promise) {
            cache.delete(key)
        }

        throw error
    })
    cache.set(key, promise)
    return promise
}

export function clearRuntimeSingletonForTests(key: string): void {
    getRuntimeCache().delete(key)
}

function getRuntimeCache(): RuntimeCache {
    const globalScope = globalThis as typeof globalThis & {
        [RUNTIME_CACHE_KEY]?: RuntimeCache
    }

    let cache = globalScope[RUNTIME_CACHE_KEY]
    if (cache === undefined) {
        cache = new Map()
        globalScope[RUNTIME_CACHE_KEY] = cache
    }

    return cache
}
