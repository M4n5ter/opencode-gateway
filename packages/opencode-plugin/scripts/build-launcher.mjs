import { spawnSync } from "node:child_process"
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(scriptDir)
const repoRoot = dirname(dirname(packageRoot))
const distRoot = join(packageRoot, "dist", "native")
const launcherName = "opencode-gateway-launcher"

const targets = [
    { key: "darwin-arm64", rustTarget: "aarch64-apple-darwin", exe: launcherName },
    { key: "darwin-x64", rustTarget: "x86_64-apple-darwin", exe: launcherName },
    { key: "linux-arm64", rustTarget: "aarch64-unknown-linux-gnu", exe: launcherName },
    { key: "linux-x64", rustTarget: "x86_64-unknown-linux-gnu", exe: launcherName },
    { key: "win32-arm64", rustTarget: "aarch64-pc-windows-gnullvm", exe: `${launcherName}.exe` },
    { key: "win32-x64", rustTarget: "x86_64-pc-windows-gnu", exe: `${launcherName}.exe` },
]

const options = parseArgs(process.argv.slice(2))

await rm(distRoot, { recursive: true, force: true })
await mkdir(distRoot, { recursive: true })

const selectedTargets = options.all ? targets : [hostTarget()]
for (const target of selectedTargets) {
    buildTarget(target, options.release)
    const source = launcherOutputPath(target, options.release)
    const destinationDir = join(distRoot, target.key)
    await mkdir(destinationDir, { recursive: true })
    await cp(source, join(destinationDir, target.exe))
}

function parseArgs(argv) {
    let all = false
    let release = true

    for (const argument of argv) {
        if (argument === "--all") {
            all = true
            continue
        }

        if (argument === "--debug") {
            release = false
            continue
        }

        throw new Error(`unknown argument: ${argument}`)
    }

    return { all, release }
}

function hostTarget() {
    const key = `${process.platform}-${process.arch}`
    const match = targets.find((target) => target.key === key)
    if (!match) {
        throw new Error(`unsupported host platform/arch: ${key}`)
    }

    return match
}

function buildTarget(target, release) {
    const command = target.key === hostTarget().key ? "cargo" : "cargo"
    const args =
        target.key === hostTarget().key
            ? ["build", "--bin", launcherName, "--target", target.rustTarget]
            : ["zigbuild", "--bin", launcherName, "--target", target.rustTarget]

    if (release) {
        args.push("--release")
    }

    const result = spawnSync(command, args, {
        cwd: repoRoot,
        stdio: "inherit",
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}

function launcherOutputPath(target, release) {
    const profile = release ? "release" : "debug"
    return join(repoRoot, "target", target.rustTarget, profile, target.exe)
}
