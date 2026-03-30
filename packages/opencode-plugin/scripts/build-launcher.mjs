import { spawnSync } from "node:child_process"
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(scriptDir)
const repoRoot = dirname(dirname(packageRoot))
const distRoot = join(packageRoot, "dist", "native")
const launcherName = "opencode-gateway-launcher"
const zigbuildDockerImage =
    process.env.OPENCODE_GATEWAY_ZIGBUILD_DOCKER_IMAGE ?? "ghcr.io/rust-cross/cargo-zigbuild:latest"

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
    const host = hostTarget()
    const useDocker = shouldUseDockerForTarget(target, host)
    if (!useDocker && target.key !== host.key) {
        ensureRustTarget(target.rustTarget)
    }

    const command = useDocker ? "docker" : "cargo"
    const args = useDocker
        ? dockerBuildArgs(target, release)
        : target.key === host.key
          ? ["build", "--bin", launcherName, "--target", target.rustTarget]
          : ["zigbuild", "--bin", launcherName, "--target", target.rustTarget]

    if (release && !useDocker) {
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

function ensureRustTarget(rustTarget) {
    const result = spawnSync("rustup", ["target", "add", rustTarget], {
        cwd: repoRoot,
        stdio: "inherit",
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}

function shouldUseDockerForTarget(target, host) {
    return isDarwinTarget(target) && process.platform !== "darwin" && target.key !== host.key
}

function isDarwinTarget(target) {
    return target.rustTarget.endsWith("apple-darwin")
}

function dockerBuildArgs(target, release) {
    const args = ["run", "--rm", "-v", `${repoRoot}:/io`, "-w", "/io"]

    const uid = typeof process.getuid === "function" ? process.getuid() : null
    const gid = typeof process.getgid === "function" ? process.getgid() : null
    if (uid !== null && gid !== null) {
        args.push("--user", `${uid}:${gid}`)
    }

    args.push(
        "-e",
        "CARGO_TARGET_DIR=/io/target",
        "-e",
        "HOME=/io/target/cargo-zigbuild-home",
        "-e",
        "CARGO_HOME=/io/target/cargo-zigbuild-home/.cargo",
        "-e",
        "RUSTUP_HOME=/io/target/cargo-zigbuild-home/.rustup",
        zigbuildDockerImage,
    )
    args.push("bash", "-c", dockerBuildCommand(target, release))

    return args
}

function dockerBuildCommand(target, release) {
    const releaseFlag = release ? " --release" : ""
    return [
        'mkdir -p "$HOME"',
        `rustup target add ${target.rustTarget}`,
        `cargo zigbuild --bin ${launcherName} --target ${target.rustTarget}${releaseFlag}`,
    ].join(" && ")
}
