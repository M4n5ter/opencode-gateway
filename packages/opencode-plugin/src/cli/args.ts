import { resolve } from "node:path"

export type CliCommand =
    | {
          kind: "help"
      }
    | {
          kind: "init" | "serve"
          managed: boolean
          configDir: string | null
      }
    | {
          kind: "doctor" | "warm"
          managed: boolean
          configDir: string | null
          serverHost: string | null
          serverPort: number | null
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
    let serverHost: string | null = null
    let serverPort: number | null = null

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

        if (argument === "--host") {
            const value = rest[index + 1]
            if (!value) {
                throw new Error("--host requires a value")
            }

            serverHost = value.trim().length > 0 ? value.trim() : null
            if (serverHost === null) {
                throw new Error("--host requires a non-empty value")
            }

            index += 1
            continue
        }

        if (argument === "--port") {
            const value = rest[index + 1]
            if (!value) {
                throw new Error("--port requires a value")
            }

            const parsed = Number.parseInt(value, 10)
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
                throw new Error("--port must be an integer between 1 and 65535")
            }

            serverPort = parsed
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

    if ((serverHost !== null || serverPort !== null) && command !== "doctor" && command !== "warm") {
        throw new Error("--host/--port are only supported for doctor and warm")
    }

    if (command === "doctor" || command === "warm") {
        return {
            kind: command,
            managed,
            configDir,
            serverHost,
            serverPort,
        }
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
        "  opencode-gateway doctor [--managed] [--config-dir <path>] [--host <host>] [--port <port>]",
        "  opencode-gateway warm [--managed] [--config-dir <path>] [--host <host>] [--port <port>]",
        "  opencode-gateway serve [--managed] [--config-dir <path>]",
        "",
        "Defaults:",
        "  init/doctor use OPENCODE_CONFIG_DIR when set, otherwise ~/.config/opencode",
        "  --managed uses ~/.config/opencode-gateway/opencode",
    ].join("\n")
}
