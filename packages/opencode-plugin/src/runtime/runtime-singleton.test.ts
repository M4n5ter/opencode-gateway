import { expect, test } from "bun:test"

import { clearRuntimeSingletonForTests, getOrCreateRuntimeSingleton } from "./runtime-singleton"

test("getOrCreateRuntimeSingleton reuses the first in-flight runtime for the same key", async () => {
    const key = "gateway-config-a"
    clearRuntimeSingletonForTests(key)

    let factoryCalls = 0
    const first = getOrCreateRuntimeSingleton(key, async () => {
        factoryCalls += 1
        await Bun.sleep(10)
        return { id: "runtime-a" }
    })
    const second = getOrCreateRuntimeSingleton(key, async () => {
        factoryCalls += 1
        return { id: "runtime-b" }
    })

    const [left, right] = await Promise.all([first, second])

    expect(factoryCalls).toBe(1)
    expect(left).toBe(right)
})

test("getOrCreateRuntimeSingleton clears a failed initialization so the next attempt can retry", async () => {
    const key = "gateway-config-b"
    clearRuntimeSingletonForTests(key)

    let factoryCalls = 0
    await expect(
        getOrCreateRuntimeSingleton(key, async () => {
            factoryCalls += 1
            throw new Error("boom")
        }),
    ).rejects.toThrow("boom")

    const runtime = await getOrCreateRuntimeSingleton(key, async () => {
        factoryCalls += 1
        return { id: "runtime-b" }
    })

    expect(factoryCalls).toBe(2)
    expect(runtime).toEqual({ id: "runtime-b" })
})
