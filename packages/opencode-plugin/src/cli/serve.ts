import { spawn } from "node:child_process"
import { ensureGatewayWorkspaceScaffold } from "../workspace/scaffold"
import { resolveServerEndpointForPid, resolveServeTarget, warmGatewayProject } from "./opencode-server"

type ServeOptions = {
    managed: boolean
    configDir: string | null
}

export async function runServe(options: ServeOptions, env: Record<string, string | undefined>): Promise<void> {
    const target = await resolveServeTarget(options, env)
    await ensureGatewayWorkspaceScaffold(target.workspaceDirPath)
    const child = spawn("opencode", ["serve"], {
        stdio: "inherit",
        env: {
            ...process.env,
            ...target.env,
            OPENCODE_GATEWAY_MANAGED: "1",
            OPENCODE_GATEWAY_CONTROL_DIR: target.controlDirPath,
        },
    })

    if (typeof child.pid === "number") {
        void resolveServerEndpointForPid(child.pid)
            .then((endpoint) => warmGatewayProject(target, { endpoint }))
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`warning: ${message}`)
                console.warn("warning: the gateway plugin may stay idle until the first project-scoped request")
            })
    } else {
        console.warn("warning: failed to determine the spawned OpenCode pid; automatic warm-up is disabled")
    }

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
