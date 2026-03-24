import { afterEach, expect, spyOn, test } from "bun:test"

import { ConsoleLoggerHost, parseGatewayLogLevel } from "./logger"

const restoreInfo = spyOn(console, "info")
const restoreWarn = spyOn(console, "warn")
const restoreError = spyOn(console, "error")
restoreInfo.mockImplementation(() => {})
restoreWarn.mockImplementation(() => {})
restoreError.mockImplementation(() => {})

afterEach(() => {
    restoreInfo.mockClear()
    restoreWarn.mockClear()
    restoreError.mockClear()
})

test("ConsoleLoggerHost stays silent when logging is off", () => {
    const logger = new ConsoleLoggerHost("off")

    logger.log("error", "boom")
    logger.log("warn", "warn")
    logger.log("info", "info")

    expect(restoreInfo).not.toHaveBeenCalled()
    expect(restoreWarn).not.toHaveBeenCalled()
    expect(restoreError).not.toHaveBeenCalled()
})

test("ConsoleLoggerHost emits only messages at or above the configured threshold", () => {
    const logger = new ConsoleLoggerHost("warn")

    logger.log("info", "ignore")
    logger.log("warn", "warn")
    logger.log("error", "boom")

    expect(restoreInfo).not.toHaveBeenCalled()
    expect(restoreWarn).toHaveBeenCalledWith("[gateway:warn] warn")
    expect(restoreError).toHaveBeenCalledWith("[gateway:error] boom")
})

test("parseGatewayLogLevel validates supported values", () => {
    expect(parseGatewayLogLevel(undefined, "gateway.log_level")).toBe("off")
    expect(parseGatewayLogLevel("debug", "gateway.log_level")).toBe("debug")
    expect(() => parseGatewayLogLevel("trace", "gateway.log_level")).toThrow(
        "gateway.log_level must be one of: off, error, warn, info, debug",
    )
})
