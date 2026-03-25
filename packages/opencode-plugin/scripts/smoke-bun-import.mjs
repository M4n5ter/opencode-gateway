import { runPluginSmoke } from "./run-plugin-smoke.mjs"

const moduleUrl = new URL("../dist/index.js", import.meta.url)
const moduleExports = await import(moduleUrl.href)

try {
    await runPluginSmoke(moduleExports)
} catch (error) {
    throw new Error(
        `published plugin entrypoint failed during Bun runtime initialization: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    )
}

process.exit(0)
