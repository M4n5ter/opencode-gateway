import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"

import { resolveServeTarget, warmGatewayProject } from "./opencode-server"

type ServeOptions = {
    managed: boolean
    configDir: string | null
}

export async function runServe(options: ServeOptions, env: Record<string, string | undefined>): Promise<void> {
    const target = await resolveServeTarget(options, env)
    await mkdir(target.workspaceDirPath, { recursive: true })
    const child = spawn("opencode", ["serve"], {
        stdio: "inherit",
        env: {
            ...process.env,
            ...target.env,
        },
    })

    void warmGatewayProject(target).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`warning: ${message}`)
        console.warn("warning: the gateway plugin may stay idle until the first project-scoped request")
    })

    const exitCode = await waitForChild(child)
    if (exitCode !== 0) {
        process.exitCode = exitCode
    }
}

function waitForChild(child: ReturnType<typeof spawn>): Promise<number> {
    return new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("exit", (code, signal) => {
            if (signal !== null) {
                resolve(1)
                return
            }

            resolve(code ?? 0)
        })
    })
}
