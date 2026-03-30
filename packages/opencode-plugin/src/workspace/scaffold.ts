import { constants } from "node:fs"
import { copyFile, mkdir, readdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

let workspaceTemplateRootPathPromise: Promise<string> | null = null

export async function ensureGatewayWorkspaceScaffold(workspaceDirPath: string): Promise<void> {
    await mkdir(workspaceDirPath, { recursive: true })
    await copyDirectoryContentsIfMissing(await resolveWorkspaceTemplateRootPath(), workspaceDirPath)
}

async function copyDirectoryContentsIfMissing(sourceDirPath: string, targetDirPath: string): Promise<void> {
    await mkdir(targetDirPath, { recursive: true })

    const entries = await readdir(sourceDirPath, { withFileTypes: true })
    for (const entry of entries) {
        const sourcePath = join(sourceDirPath, entry.name)
        const targetPath = join(targetDirPath, entry.name)

        if (entry.isDirectory()) {
            await copyDirectoryContentsIfMissing(sourcePath, targetPath)
            continue
        }

        if (entry.isFile()) {
            await copyFileIfMissing(sourcePath, targetPath)
        }
    }
}

async function copyFileIfMissing(sourcePath: string, targetPath: string): Promise<void> {
    if (await pathExists(targetPath)) {
        return
    }

    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL)
}

async function resolveWorkspaceTemplateRootPath(): Promise<string> {
    workspaceTemplateRootPathPromise ??= (async () => {
        const packageRoot = process.env.OPENCODE_GATEWAY_PACKAGE_ROOT ?? (await resolvePackageRoot(fileURLToPath(import.meta.url)))
        const templateRootPath = join(packageRoot, "templates", "workspace")

        if (!(await pathExists(templateRootPath))) {
            throw new Error(`workspace template root is missing: ${templateRootPath}`)
        }

        return templateRootPath
    })()

    return await workspaceTemplateRootPathPromise
}

async function resolvePackageRoot(sourceFilePath: string): Promise<string> {
    let currentDirPath = dirname(sourceFilePath)

    while (true) {
        if (await pathExists(join(currentDirPath, "package.json"))) {
            return currentDirPath
        }

        const parentDirPath = dirname(currentDirPath)
        if (parentDirPath === currentDirPath) {
            throw new Error(`failed to resolve package root for scaffold module: ${sourceFilePath}`)
        }

        currentDirPath = parentDirPath
    }
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false
        }

        throw error
    }
}
