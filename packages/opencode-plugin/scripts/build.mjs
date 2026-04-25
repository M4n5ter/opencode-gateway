import { spawnSync } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cliOutputPath = `${packageRoot}/dist/cli.js`
const pluginOutputPath = `${packageRoot}/dist/index.js`

await rm(`${packageRoot}/dist`, { recursive: true, force: true })

run("node", [
    "./scripts/build-launcher.mjs",
    ...(process.env.OPENCODE_GATEWAY_BUILD_LAUNCHER_ALL === "1" ? ["--all"] : []),
])
run("tsc", ["--project", "tsconfig.build.json", "--emitDeclarationOnly"])
run("bun", [
    "build",
    "./src/index.ts",
    "--outfile",
    pluginOutputPath,
    "--target",
    "node",
    "--format",
    "esm",
    "--external",
    "better-sqlite3",
    "--external",
    "@ff-labs/fff-node",
    "--external",
    "undici",
])
run("bun", ["build", "./src/cli.ts", "--outfile", cliOutputPath, "--target", "node", "--format", "esm"])

const cliSource = await readFile(cliOutputPath, "utf8")
if (!cliSource.startsWith("#!/usr/bin/env node")) {
    await writeFile(cliOutputPath, `#!/usr/bin/env node\n${cliSource}`)
}

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: packageRoot,
        stdio: "inherit",
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }
}
