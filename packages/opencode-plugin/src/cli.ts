#!/usr/bin/env node

import { formatCliHelp, parseCliCommand } from "./cli/args"
import { runDoctor } from "./cli/doctor"
import { runInit } from "./cli/init"

async function main(): Promise<void> {
    const command = parseCliCommand(process.argv.slice(2))

    switch (command.kind) {
        case "help":
            console.log(formatCliHelp())
            return
        case "doctor":
            await runDoctor(command, process.env)
            return
        case "init":
            await runInit(command, process.env)
            return
    }
}

void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exitCode = 1
})
