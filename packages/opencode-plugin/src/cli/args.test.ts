import { expect, test } from "bun:test"

import { formatCliHelp, parseCliCommand } from "./args"

test("parseCliCommand accepts serve and warm commands", () => {
    expect(parseCliCommand(["serve"])).toEqual({
        kind: "serve",
        managed: false,
        configDir: null,
    })
    expect(parseCliCommand(["warm", "--managed"])).toEqual({
        kind: "warm",
        managed: true,
        configDir: null,
    })
})

test("formatCliHelp lists serve and warm commands", () => {
    const help = formatCliHelp()

    expect(help).toContain("opencode-gateway warm")
    expect(help).toContain("opencode-gateway serve")
})
