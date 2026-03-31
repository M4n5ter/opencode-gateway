const RUNTIME_CACHE_KEY = Symbol.for("opencode-gateway.runtime-cache")

type RuntimeCache = Map<string, Promise<unknown>>
type RuntimeReusePredicate<T> = (value: unknown) => value is T

export async function getOrCreateRuntimeSingleton<T>(
    key: string,
    factory: () => Promise<T>,
    options: {
        isReusable?: RuntimeReusePredicate<T>
    } = {},
): Promise<T> {
    const cache = getRuntimeCache()
    while (true) {
        const existing = cache.get(key)
        if (existing !== undefined) {
            const value = await existing
            if (options.isReusable === undefined || options.isReusable(value)) {
                return value as T
            }

            if (cache.get(key) === existing) {
                cache.delete(key)
            }

            continue
        }

        const promise = factory().catch((error) => {
            if (cache.get(key) === promise) {
                cache.delete(key)
            }

            throw error
        })
        cache.set(key, promise)
        return await promise
    }
}

export function clearRuntimeSingleton(key: string): void {
    getRuntimeCache().delete(key)
}

export const clearRuntimeSingletonForTests = clearRuntimeSingleton

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
