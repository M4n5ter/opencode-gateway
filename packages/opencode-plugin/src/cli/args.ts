import { resolve } from "node:path"

export type CliCommand =
    | {
          kind: "help"
      }
    | {
          kind: "init" | "doctor" | "serve" | "warm"
          managed: boolean
          configDir: string | null
      }

export function parseCliCommand(argv: string[]): CliCommand {
    const [command, ...rest] = argv

    if (!command || command === "help" || command === "--help" || command === "-h") {
        return { kind: "help" }
    }

    if (command !== "init" && command !== "doctor" && command !== "serve" && command !== "warm") {
        throw new Error(`unknown command: ${command}`)
    }

    let managed = false
    let configDir: string | null = null

    for (let index = 0; index < rest.length; index += 1) {
        const argument = rest[index]

        if (argument === "--managed") {
            managed = true
            continue
        }

        if (argument === "--config-dir") {
            const value = rest[index + 1]
            if (!value) {
                throw new Error("--config-dir requires a value")
            }

            configDir = resolve(value)
            index += 1
            continue
        }

        if (argument === "--help" || argument === "-h") {
            return { kind: "help" }
        }

        throw new Error(`unknown argument: ${argument}`)
    }

    if (managed && configDir !== null) {
        throw new Error("--managed cannot be combined with --config-dir")
    }

    return {
        kind: command,
        managed,
        configDir,
    }
}

export function formatCliHelp(): string {
    return [
        "opencode-gateway",
        "",
        "Commands:",
        "  opencode-gateway init [--managed] [--config-dir <path>]",
        "  opencode-gateway doctor [--managed] [--config-dir <path>]",
        "  opencode-gateway warm [--managed] [--config-dir <path>]",
        "  opencode-gateway serve [--managed] [--config-dir <path>]",
        "",
        "Defaults:",
        "  init/doctor use OPENCODE_CONFIG_DIR when set, otherwise ~/.config/opencode",
        "  --managed uses ~/.config/opencode-gateway/opencode",
    ].join("\n")
}
