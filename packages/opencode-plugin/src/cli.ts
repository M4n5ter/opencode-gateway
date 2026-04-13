#!/usr/bin/env node

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { access } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { formatCliHelp, parseCliCommand } from "./cli/args"
import { resolveNativeLauncher } from "./cli/native-launcher"

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function main(): Promise<void> {
    const command = parseCliCommand(process.argv.slice(2))
    if (command.kind === "help") {
        console.log(formatCliHelp())
        return
    }

    const launcher = resolveNativeLauncherPath()
    await ensurePathExists(launcher)

    const child = spawn(launcher.path, [command.kind], {
        stdio: "inherit",
        env: {
            ...process.env,
            OPENCODE_GATEWAY_PACKAGE_ROOT: packageRoot,
            ...launcherEnv(command),
        },
    })

    await new Promise<void>((resolvePromise, reject) => {
        child.once("error", reject)
        child.once("exit", (code, signal) => {
            if (signal !== null) {
                process.exitCode = 1
            } else {
                process.exitCode = code ?? 0
            }
            resolvePromise()
        })
    })
}

function resolveNativeLauncherPath() {
    return resolveNativeLauncher(packageRoot, process.platform, process.arch, (packageName) => {
        try {
            return require.resolve(`${packageName}/package.json`, {
                paths: [packageRoot],
            })
        } catch {
            return null
        }
    })
}

function launcherEnv(command: Exclude<ReturnType<typeof parseCliCommand>, { kind: "help" }>): Record<string, string> {
    const env: Record<string, string> = {}

    if (command.managed) {
        env.OPENCODE_GATEWAY_LAUNCHER_MANAGED = "1"
    }

    if (command.configDir !== null) {
        env.OPENCODE_GATEWAY_LAUNCHER_CONFIG_DIR = resolve(command.configDir)
    }

    if ("serverHost" in command && command.serverHost !== null) {
        env.OPENCODE_GATEWAY_LAUNCHER_SERVER_HOST = command.serverHost
    }

    if ("serverPort" in command && command.serverPort !== null) {
        env.OPENCODE_GATEWAY_LAUNCHER_SERVER_PORT = String(command.serverPort)
    }

    return env
}

async function ensurePathExists(launcher: ReturnType<typeof resolveNativeLauncherPath>): Promise<void> {
    try {
        await access(launcher.path)
    } catch {
        const reinstallHint =
            "Reinstall opencode-gateway to fetch the matching native package. If you are running from a source checkout, build the local launcher first."
        throw new Error(`native launcher is missing for ${launcher.target.key}: ${launcher.path}. ${reinstallHint}`)
    }
}

void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exitCode = 1
})
