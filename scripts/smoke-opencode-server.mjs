import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const EXPECTED_TOOL_IDS = [
    "agent_status",
    "agent_switch",
    "cron_run",
    "cron_upsert",
    "gateway_dispatch_cron",
    "gateway_restart",
    "gateway_status",
    "schedule_cancel",
    "schedule_list",
    "schedule_once",
    "schedule_status",
    "session_list",
    "session_search",
    "session_view",
]

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const userHome =
    process.env.HOME ??
    (() => {
        throw new Error("HOME must be set")
    })()
const tempRoot = await mkdtemp(join(tmpdir(), "opencode-gateway-smoke-"))
const configHome = join(tempRoot, ".config")
const dataHome = join(tempRoot, ".local", "share")
const gatewayRoot = join(configHome, "opencode-gateway")
const opencodeRoot = join(gatewayRoot, "opencode")
const configuredPort = await choosePort()

const baseEnv = {
    ...process.env,
    HOME: tempRoot,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    OPENCODE_GATEWAY_LAUNCHER_MANAGED: "1",
    CARGO_HOME: process.env.CARGO_HOME ?? join(userHome, ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(userHome, ".rustup"),
    BUN_INSTALL: process.env.BUN_INSTALL ?? join(userHome, ".bun"),
}

let child
let stdoutPump = Promise.resolve("")
let stderrPump = Promise.resolve("")

try {
    await runCommand(["cargo", "run", "-p", "opencode-gateway-launcher", "--", "init"], baseEnv)
    const opencodeConfigPath = await resolveManagedOpencodeConfigPath(opencodeRoot)
    await rewriteManagedOpencodeConfig(opencodeConfigPath, configuredPort)

    child = Bun.spawn(["opencode", "serve"], {
        cwd: REPO_ROOT,
        detached: true,
        env: {
            ...baseEnv,
            OPENCODE_CONFIG: opencodeConfigPath,
            OPENCODE_CONFIG_DIR: opencodeRoot,
        },
        stdout: "pipe",
        stderr: "pipe",
    })

    const logState = createLogState()
    stdoutPump = readStream(child.stdout, (chunk) => {
        logState.stdout += chunk
        updatePortFromChunk(logState, chunk)
    })
    stderrPump = readStream(child.stderr, (chunk) => {
        logState.stderr += chunk
        updatePortFromChunk(logState, chunk)
    })

    const actualPort = await withTimeout(logState.portPromise, 20_000, "failed to discover OpenCode listen port")
    const tools = await pollToolIds(actualPort, logState)
    const missing = EXPECTED_TOOL_IDS.filter((toolId) => !tools.includes(toolId))

    if (missing.length > 0) {
        throw new Error(`missing expected tool ids: ${missing.join(", ")}`)
    }

    console.log(`opencode smoke passed on port ${actualPort}`)
    console.log(`tools=${tools.join(",")}`)
} finally {
    if (child) {
        try {
            process.kill(-child.pid, "SIGTERM")
        } catch {}

        child.kill()
        await child.exited
    }

    await Promise.allSettled([stdoutPump, stderrPump])
    await rm(tempRoot, { recursive: true, force: true })
}

async function resolveManagedOpencodeConfigPath(configDir) {
    const jsoncPath = join(configDir, "opencode.jsonc")
    try {
        await readFile(jsoncPath, "utf8")
        return jsoncPath
    } catch {}

    return join(configDir, "opencode.json")
}

async function rewriteManagedOpencodeConfig(configPath, port) {
    const raw = await readFile(configPath, "utf8")
    const next = JSON.parse(raw)
    next.server = {
        ...(next.server ?? {}),
        hostname: "127.0.0.1",
        port,
    }

    await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`)
}

async function pollToolIds(port, logState) {
    const deadline = Date.now() + 20_000
    let lastError = "server did not become ready"

    while (Date.now() < deadline) {
        try {
            const response = await fetch(
                `http://127.0.0.1:${port}/experimental/tool/ids?directory=${encodeURIComponent(REPO_ROOT)}`,
            )

            if (!response.ok) {
                lastError = `HTTP ${response.status}`
            } else {
                return await response.json()
            }
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error)
        }

        if (child?.exited) {
            throw new Error(`opencode serve exited early: ${formatLogState(logState)}`)
        }

        await Bun.sleep(500)
    }

    throw new Error(lastError)
}

async function readChildOutput(process) {
    const [stdout, stderr] = await Promise.all([readStream(process.stdout), readStream(process.stderr)])
    return [stdout, stderr].filter((chunk) => chunk.length > 0).join("\n")
}

async function readStream(stream, onChunk) {
    if (!stream) {
        return ""
    }

    const reader = stream.getReader()
    const chunks = []

    try {
        for (;;) {
            const { value, done } = await reader.read()
            if (done) {
                break
            }

            const chunk = typeof value === "string" ? value : Buffer.from(value).toString("utf8")
            chunks.push(chunk)
            onChunk?.(chunk)
        }
    } finally {
        reader.releaseLock()
    }

    return chunks.join("")
}

async function runCommand(argv, env) {
    const command = Bun.spawn(argv, {
        cwd: REPO_ROOT,
        env,
        stdout: "pipe",
        stderr: "pipe",
    })
    const exitCode = await command.exited
    if (exitCode === 0) {
        return
    }

    throw new Error(`command failed (${argv.join(" ")}): ${await readChildOutput(command)}`)
}

async function choosePort() {
    const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
            data() {},
        },
    })

    try {
        return server.port
    } finally {
        server.stop()
    }
}

function createLogState() {
    let resolvePort
    const portPromise = new Promise((resolve) => {
        resolvePort = resolve
    })

    return {
        stdout: "",
        stderr: "",
        resolvedPort: null,
        portPromise,
        resolvePort,
    }
}

function updatePortFromChunk(logState, chunk) {
    if (logState.resolvedPort !== null) {
        return
    }

    const match = chunk.match(/opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/)
    if (!match) {
        return
    }

    logState.resolvedPort = Number.parseInt(match[1], 10)
    logState.resolvePort(logState.resolvedPort)
}

function formatLogState(logState) {
    return [logState.stdout, logState.stderr].filter((chunk) => chunk.length > 0).join("\n")
}

async function withTimeout(promise, timeoutMs, message) {
    let timeoutId = null

    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(message))
                }, timeoutMs)
            }),
        ])
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId)
        }
    }
}
