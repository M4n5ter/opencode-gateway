import { ensureGatewayWorkspaceScaffold } from "../workspace/scaffold"
import { resolveServeTarget, warmGatewayProject } from "./opencode-server"

type WarmOptions = {
    managed: boolean
    configDir: string | null
    serverHost: string | null
    serverPort: number | null
}

export async function runWarm(options: WarmOptions, env: Record<string, string | undefined>): Promise<void> {
    const target = await resolveServeTarget(options, env)
    await ensureGatewayWorkspaceScaffold(target.workspaceDirPath)

    await warmGatewayProject(target)

    console.log(`gateway plugin warmed: ${target.serverOrigin}`)
    console.log(`warm directory: ${target.workspaceDirPath}`)
}
