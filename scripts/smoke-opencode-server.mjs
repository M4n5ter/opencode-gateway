import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

import { stageLocalSmokePackages } from "../packages/opencode-plugin/scripts/npm-package-staging.mjs"
import { NATIVE_TARGETS, hostNativeTarget, optionalPlatformPackageName } from "../packages/opencode-plugin/scripts/native-targets.mjs"

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
const PACKAGE_ROOT = join(REPO_ROOT, "packages/opencode-plugin")
const userHome =
    process.env.HOME ??
    (() => {
        throw new Error("HOME must be set")
    })()
const tempRoot = await mkdtemp(join(tmpdir(), "opencode-gateway-smoke-"))
const installRoot = join(tempRoot, "npm-install")
const bunInstallRoot = join(tempRoot, "bun-install")
const configHome = join(tempRoot, ".config")
const dataHome = join(tempRoot, ".local", "share")
const gatewayRoot = join(configHome, "opencode-gateway")
const opencodeRoot = join(gatewayRoot, "opencode")
const configuredPort = await choosePort()
const hostTarget = hostNativeTarget()

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
    await ensureBuildArtifacts()

    const stagingRoot = join(tempRoot, "staging")
    const tarballRoot = join(tempRoot, "packed")
    await mkdir(stagingRoot, { recursive: true })
    await mkdir(tarballRoot, { recursive: true })

    const staged = await stageLocalSmokePackages({
        stageRoot: stagingRoot,
        nativeDistRoot: join(PACKAGE_ROOT, "dist", "native"),
        packPackage,
    })
    const mainTarball = await packPackage(staged.mainDirectory, tarballRoot)

    console.log("[smoke:opencode] npm install staged tarballs")
    await installFromTarball("npm", installRoot, mainTarball, staged.platformPackages)
    await verifyInstalledPlatformPackages(installRoot)

    console.log("[smoke:opencode] bun install staged tarballs")
    await installFromTarball("bun", bunInstallRoot, mainTarball, staged.platformPackages)
    await verifyInstalledPlatformPackages(bunInstallRoot, { allowExtraPackages: true })
    console.log("[smoke:opencode] bun launcher init")
    await runCommand([gatewayCliPath(bunInstallRoot), "init", "--managed"], {
        ...baseEnv,
        HOME: join(tempRoot, "bun-home"),
        XDG_CONFIG_HOME: join(tempRoot, "bun-home", ".config"),
        XDG_DATA_HOME: join(tempRoot, "bun-home", ".local", "share"),
    }, bunInstallRoot)

    console.log("[smoke:opencode] npm launcher init")
    await runCommand([gatewayCliPath(installRoot), "init", "--managed"], baseEnv, installRoot)
    const opencodeConfigPath = await resolveManagedOpencodeConfigPath(opencodeRoot)
    await rewriteManagedOpencodeConfig(opencodeConfigPath, configuredPort)

    console.log("[smoke:opencode] npm launcher serve")
    child = Bun.spawn([gatewayCliPath(installRoot), "serve", "--managed"], {
        cwd: installRoot,
        detached: true,
        env: baseEnv,
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

async function ensureBuildArtifacts() {
    runStep("build:binding", "bun", ["run", "build:binding"], REPO_ROOT)
    runStep("build:plugin", "bun", ["run", "--cwd", "packages/opencode-plugin", "build"], REPO_ROOT)
}

async function installFromTarball(packageManager, destinationRoot, tarballPath, platformPackages) {
    await mkdir(destinationRoot, { recursive: true })
    await writeFile(
        join(destinationRoot, "package.json"),
        `${JSON.stringify(
            {
                name: "opencode-gateway-smoke",
                private: true,
                dependencies: {
                    "opencode-gateway": `file:${tarballPath}`,
                },
                optionalDependencies: Object.fromEntries(
                    platformPackages.map((platformPackage) => [
                        platformPackage.aliasName,
                        `file:${platformPackage.tarballPath}`,
                    ]),
                ),
            },
            null,
            2,
        )}\n`,
    )

    if (packageManager === "npm") {
        await runCommand(["npm", "install", "--ignore-scripts"], baseEnv, destinationRoot)
        return
    }

    await runCommand(["bun", "install"], baseEnv, destinationRoot)
}

async function verifyInstalledPlatformPackages(destinationRoot, { allowExtraPackages = false } = {}) {
    const installedHostPackage = join(
        destinationRoot,
        "node_modules",
        optionalPlatformPackageName(hostTarget),
        "package.json",
    )
    await access(installedHostPackage)

    for (const target of NATIVE_TARGETS) {
        if (target.key === hostTarget.key) {
            continue
        }

        const packagePath = join(destinationRoot, "node_modules", optionalPlatformPackageName(target), "package.json")
        if (!allowExtraPackages && (await pathExists(packagePath))) {
            throw new Error(`unexpected non-host platform package installed: ${optionalPlatformPackageName(target)}`)
        }
    }
}

function gatewayCliPath(destinationRoot) {
    return join(
        destinationRoot,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "opencode-gateway.cmd" : "opencode-gateway",
    )
}

async function resolveManagedOpencodeConfigPath(configDir) {
    const jsoncPath = join(configDir, "opencode.jsonc")
    if (await pathExists(jsoncPath)) {
        return jsoncPath
    }

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

        if (child && child.exitCode !== null) {
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

async function runCommand(argv, env, cwd) {
    const command = Bun.spawn(argv, {
        cwd,
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

async function pathExists(path) {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

async function packPackage(packageDirectory, destinationDirectory) {
    const result = spawnSync("npm", ["pack", "--json"], {
        cwd: packageDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }

    const [{ filename }] = JSON.parse(result.stdout)
    const source = join(packageDirectory, filename)
    const destination = join(destinationDirectory, filename)
    await rename(source, destination)
    return destination
}

function runStep(label, command, args, cwd) {
    console.log(`[smoke:opencode] ${label}`)
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
        env: process.env,
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}
