import { spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(repoRoot, "packages/opencode-plugin/generated/wasm/pkg")
const wasmPath = join(
    repoRoot,
    "target/wasm32-unknown-unknown/release/opencode_gateway_ffi.wasm",
)

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

run(
    ["cargo", "build", "--target", "wasm32-unknown-unknown", "--release", "-p", "opencode-gateway-ffi"],
    repoRoot,
)
run(["wasm-bindgen", "--target", "nodejs", "--out-dir", outDir, wasmPath], repoRoot)

function run(argv, cwd) {
    const result = spawnSync(argv[0], argv.slice(1), {
        cwd,
        stdio: "inherit",
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}
