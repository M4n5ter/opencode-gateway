import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageRoot = join(repoRoot, "packages/opencode-plugin")

const options = parseArgs(process.argv.slice(2))

run("bun", ["run", "check:binding"], repoRoot)
run("bun", ["run", "check:plugin"], repoRoot)
run("cargo", ["test"], repoRoot)
run("cargo", ["clippy", "--all-targets", "--all-features"], repoRoot)
run("npm", ["pack", "--dry-run"], packageRoot)

if (!options.publish) {
    console.log("dry-run complete; rerun with --publish to publish opencode-gateway")
    process.exit(0)
}

const publishArgs = ["publish", "--access", "public"]
if (options.tag !== null) {
    publishArgs.push("--tag", options.tag)
}
if (options.otp !== null) {
    publishArgs.push("--otp", options.otp)
}

run("npm", publishArgs, packageRoot)

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

function run(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}
