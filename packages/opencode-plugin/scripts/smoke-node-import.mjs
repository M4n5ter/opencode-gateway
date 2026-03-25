import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const moduleUrl = new URL("../dist/index.js", import.meta.url)
const moduleExports = await import(moduleUrl.href)

if (typeof moduleExports.default !== "function") {
    throw new Error("published plugin entrypoint does not export a default plugin function")
}

const tempRoot = await mkdtemp(join(tmpdir(), "opencode-gateway-smoke-"))
const configPath = join(tempRoot, "opencode-gateway.toml")
const stateDbPath = join(tempRoot, "state.db")

try {
    await writeFile(
        configPath,
        [
            "[gateway]",
            `state_db = ${JSON.stringify(stateDbPath)}`,
            'log_level = "off"',
            "",
            "[cron]",
            "enabled = false",
            "",
            "[channels.telegram]",
            "enabled = false",
            "",
        ].join("\n"),
        "utf8",
    )

    process.env.OPENCODE_GATEWAY_CONFIG = configPath

    const plugin = moduleExports.default
    await plugin({
        app: {},
        chat: {},
        client: {
            event: {
                subscribe: async () => ({
                    stream: (async function* () {})(),
                }),
            },
        },
        directory: tempRoot,
        project: {},
        serverUrl: new URL("http://127.0.0.1:4096"),
        settings: {},
        tool: {},
    })
} catch (error) {
    throw new Error(
        `published plugin entrypoint failed during runtime initialization: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    )
} finally {
    delete process.env.OPENCODE_GATEWAY_CONFIG
    await rm(tempRoot, { recursive: true, force: true })
}

process.exit(0)
