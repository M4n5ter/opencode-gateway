import { mkdir } from "node:fs/promises"

import { resolveServeTarget, warmGatewayProject } from "./opencode-server"

type WarmOptions = {
    managed: boolean
    configDir: string | null
}

export async function runWarm(options: WarmOptions, env: Record<string, string | undefined>): Promise<void> {
    const target = await resolveServeTarget(options, env)
    await mkdir(target.workspaceDirPath, { recursive: true })

    await warmGatewayProject(target)

    console.log(`gateway plugin warmed: ${target.serverOrigin}`)
    console.log(`warm directory: ${target.workspaceDirPath}`)
}
