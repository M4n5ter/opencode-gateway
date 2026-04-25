import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { NATIVE_TARGETS, optionalPlatformPackageName, platformPackageVersion } from "./native-targets.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = dirname(scriptDir)

const MAIN_PACKAGE_FIELDS = [
    "name",
    "version",
    "description",
    "license",
    "type",
    "main",
    "types",
    "bin",
    "exports",
    "files",
    "keywords",
    "engines",
    "repository",
    "bugs",
    "homepage",
    "publishConfig",
    "dependencies",
]

export async function stageRegistryPackages({ stageRoot, nativeDistRoot }) {
    const manifest = await readSourceManifest()
    const packagesRoot = join(stageRoot, "packages")
    await mkdir(packagesRoot, { recursive: true })

    const platformPackages = []
    for (const target of NATIVE_TARGETS) {
        const directory = join(packagesRoot, target.key)
        await stagePlatformPackage({
            directory,
            manifest,
            target,
            nativeDistRoot,
            missingBinary: "error",
        })
        platformPackages.push({
            directory,
            target,
            aliasName: optionalPlatformPackageName(target),
            version: platformPackageVersion(manifest.version, target),
        })
    }

    const mainDirectory = join(packagesRoot, "main")
    await stageMainPackage({
        directory: mainDirectory,
        manifest,
        optionalDependencies: buildRegistryOptionalDependencies(manifest.version),
    })

    return {
        mainDirectory,
        platformPackages,
    }
}

export async function stageLocalSmokePackages({ stageRoot, nativeDistRoot, packPackage }) {
    const manifest = await readSourceManifest()
    const platformRoot = join(stageRoot, "platform")
    const tarballRoot = join(stageRoot, "tarballs")
    await mkdir(platformRoot, { recursive: true })
    await mkdir(tarballRoot, { recursive: true })

    const packedPlatforms = []
    for (const target of NATIVE_TARGETS) {
        const directory = join(platformRoot, target.key)
        await stagePlatformPackage({
            directory,
            manifest,
            target,
            nativeDistRoot,
            missingBinary: "stub",
        })

        const tarballPath = await packPackage(directory, tarballRoot)
        packedPlatforms.push({
            target,
            aliasName: optionalPlatformPackageName(target),
            tarballPath,
        })
    }

    const mainDirectory = join(stageRoot, "main")
    await stageMainPackage({
        directory: mainDirectory,
        manifest,
        optionalDependencies: undefined,
    })

    return {
        mainDirectory,
        platformPackages: packedPlatforms,
    }
}

async function stageMainPackage({ directory, manifest, optionalDependencies, extraFiles = [] }) {
    await rm(directory, { recursive: true, force: true })
    await mkdir(directory, { recursive: true })

    await stageCommonFiles(directory)
    await cp(join(packageRoot, "dist"), join(directory, "dist"), { recursive: true })
    await rm(join(directory, "dist", "native"), { recursive: true, force: true })
    await cp(join(packageRoot, "generated"), join(directory, "generated"), { recursive: true })
    await cp(join(packageRoot, "templates"), join(directory, "templates"), { recursive: true })

    const nextManifest = {
        ...pickFields(manifest, MAIN_PACKAGE_FIELDS),
        files: uniqueFiles([...(manifest.files ?? []), ...extraFiles]),
    }
    if (optionalDependencies !== undefined) {
        nextManifest.optionalDependencies = optionalDependencies
    }
    await writeJson(join(directory, "package.json"), nextManifest)
}

async function stagePlatformPackage({ directory, manifest, target, nativeDistRoot, missingBinary }) {
    await rm(directory, { recursive: true, force: true })
    await mkdir(join(directory, "vendor", target.key), { recursive: true })

    await stageCommonFiles(directory)

    const binaryPath = join(nativeDistRoot, target.key, target.exe)
    const stagedBinaryPath = join(directory, "vendor", target.key, target.exe)
    const copied = await copyBinary(binaryPath, stagedBinaryPath)
    if (!copied) {
        if (missingBinary !== "stub") {
            throw new Error(`missing launcher binary for ${target.key}: ${binaryPath}`)
        }

        await writeFile(stagedBinaryPath, `placeholder launcher for ${target.key}\n`)
    }

    if (!target.exe.endsWith(".exe")) {
        await chmod(stagedBinaryPath, 0o755)
    }

    await writeJson(join(directory, "package.json"), {
        name: manifest.name,
        version: platformPackageVersion(manifest.version, target),
        description: manifest.description,
        license: manifest.license,
        files: ["vendor", "README.md", "LICENSE"],
        os: [target.os],
        cpu: [target.cpu],
        publishConfig: manifest.publishConfig,
        repository: manifest.repository,
        bugs: manifest.bugs,
        homepage: manifest.homepage,
    })
}

async function stageCommonFiles(directory) {
    await cp(join(packageRoot, "README.md"), join(directory, "README.md"))
    await cp(join(packageRoot, "LICENSE"), join(directory, "LICENSE"))
}

async function copyBinary(source, destination) {
    try {
        await cp(source, destination)
        return true
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return false
        }

        throw error
    }
}

function buildRegistryOptionalDependencies(baseVersion) {
    return Object.fromEntries(
        NATIVE_TARGETS.map((target) => [
            optionalPlatformPackageName(target),
            `npm:opencode-gateway@${platformPackageVersion(baseVersion, target)}`,
        ]),
    )
}

function pickFields(source, fields) {
    return Object.fromEntries(fields.filter((field) => field in source).map((field) => [field, source[field]]))
}

function uniqueFiles(files) {
    return [...new Set(files)]
}

async function readSourceManifest() {
    return JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
}

async function writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
