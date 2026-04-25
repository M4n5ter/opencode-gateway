import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { platformDistTag } from "../packages/opencode-plugin/scripts/native-targets.mjs"
import { stageRegistryPackages } from "../packages/opencode-plugin/scripts/npm-package-staging.mjs"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageRoot = join(repoRoot, "packages/opencode-plugin")
const options = parseArgs(process.argv.slice(2))
const stagingRoot = await mkdtemp(join(tmpdir(), "opencode-gateway-npm-"))

try {
    runStep("check:binding", "bun", ["run", "check:binding"], repoRoot)
    runStep("check:plugin", "bun", ["run", "check:plugin"], repoRoot)
    runStep("cargo test", "cargo", ["test"], repoRoot)
    runStep("cargo clippy", "cargo", ["clippy", "--all-targets", "--all-features"], repoRoot)

    const nativeDistRoot = join(stagingRoot, "native")
    runStep(
        "build launcher matrix",
        "node",
        ["./scripts/build-launcher.mjs", "--all", "--out-dir", nativeDistRoot],
        packageRoot,
    )

    const staged = await stageRegistryPackages({
        stageRoot: stagingRoot,
        nativeDistRoot,
    })

    verifyMainPackage(npmPackJson(staged.mainDirectory, true))
    for (const platformPackage of staged.platformPackages) {
        await verifyPlatformPackage(npmPackJson(platformPackage.directory, true), platformPackage.target)
    }

    if (!options.publish) {
        console.log("dry-run complete; rerun with --publish to publish opencode-gateway")
        process.exit(0)
    }

    for (const platformPackage of staged.platformPackages) {
        runStep(
            `npm publish ${platformPackage.target.key}`,
            "npm",
            publishArgs(platformDistTag(options.tag, platformPackage.target), options.otp),
            platformPackage.directory,
        )
    }

    runStep("npm publish main", "npm", publishArgs(options.tag, options.otp), staged.mainDirectory)
} finally {
    await rm(stagingRoot, { recursive: true, force: true })
}

function parseArgs(argv) {
    let publish = false
    let tag = null
    let otp = null

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]

        if (argument === "--publish") {
            publish = true
            continue
        }

        if (argument === "--tag") {
            tag = argv[index + 1] ?? null
            if (tag === null) {
                throw new Error("--tag requires a value")
            }
            index += 1
            continue
        }

        if (argument === "--otp") {
            otp = argv[index + 1] ?? null
            if (otp === null) {
                throw new Error("--otp requires a value")
            }
            index += 1
            continue
        }

        throw new Error(`unknown argument: ${argument}`)
    }

    return { publish, tag, otp }
}

function publishArgs(tag, otp) {
    const args = ["publish", "--access", "public"]
    if (tag !== null) {
        args.push("--tag", tag)
    }
    if (otp !== null) {
        args.push("--otp", otp)
    }
    return args
}

function verifyMainPackage(packResult) {
    const nativeFiles = packResult.files.filter((entry) => entry.path.startsWith("dist/native/"))
    if (nativeFiles.length > 0) {
        throw new Error(
            `main package unexpectedly includes native payloads: ${nativeFiles.map((entry) => entry.path).join(", ")}`,
        )
    }
}

async function verifyPlatformPackage(packResult, target) {
    const manifest = JSON.parse(await readFile(join(packResult.directory, "package.json"), "utf8"))
    const expectedBinary = `vendor/${target.key}/${target.exe}`
    const vendorFiles = packResult.files.filter((entry) => entry.path.startsWith("vendor/"))

    if (vendorFiles.length !== 1 || vendorFiles[0]?.path !== expectedBinary) {
        throw new Error(
            `platform package ${target.key} must include exactly one launcher payload (${expectedBinary}), got: ${vendorFiles.map((entry) => entry.path).join(", ")}`,
        )
    }

    if (JSON.stringify(manifest.os) !== JSON.stringify([target.os])) {
        throw new Error(`platform package ${target.key} has unexpected os metadata: ${JSON.stringify(manifest.os)}`)
    }

    if (JSON.stringify(manifest.cpu) !== JSON.stringify([target.cpu])) {
        throw new Error(`platform package ${target.key} has unexpected cpu metadata: ${JSON.stringify(manifest.cpu)}`)
    }
}

function npmPackJson(packageDirectory, dryRun) {
    const args = ["pack", "--json"]
    if (dryRun) {
        args.push("--dry-run")
    }

    const result = spawnSync("npm", args, {
        cwd: packageDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }

    const parsed = JSON.parse(result.stdout)
    const [packResult] = parsed
    return {
        ...packResult,
        directory: packageDirectory,
    }
}

function run(command, args, cwd, env = process.env) {
    const result = spawnSync(command, args, {
        cwd,
        env,
        stdio: "inherit",
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}

function runStep(label, command, args, cwd, env) {
    console.log(`[publish:npm] ${label}`)
    run(command, args, cwd, env)
}
