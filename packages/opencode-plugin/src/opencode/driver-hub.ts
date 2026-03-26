import type {
    BindingExecutionObservation,
    BindingProgressiveDirective,
    BindingProgressivePreview,
    OpencodeExecutionDriver,
} from "../binding"
import { normalizeExecutionObservation, type OpencodeRuntimeEvent } from "./event-normalize"

type TextSnapshotHandler = (preview: BindingProgressivePreview) => Promise<void> | void

type ActiveDriver = {
    driver: OpencodeExecutionDriver
    onPreview: TextSnapshotHandler
}

export class OpencodeEventHub {
    private readonly activeDrivers = new Map<string, Map<number, ActiveDriver>>()
    private nextDriverId = 0

    registerDriver(
        sessionId: string,
        driver: OpencodeExecutionDriver,
        onPreview: TextSnapshotHandler,
    ): {
        dispose(): void
        updateSession(sessionId: string): void
    } {
        const driverId = this.nextDriverId++
        attachDriver(this.activeDrivers, sessionId, driverId, {
            driver,
            onPreview,
        })

        return {
            dispose: () => {
                detachDriver(this.activeDrivers, sessionId, driverId)
            },
            updateSession: (nextSessionId: string) => {
                if (nextSessionId === sessionId) {
                    return
                }

                const current = this.activeDrivers.get(sessionId)?.get(driverId)
                if (!current) {
                    return
                }

                detachDriver(this.activeDrivers, sessionId, driverId)
                attachDriver(this.activeDrivers, nextSessionId, driverId, current)
                sessionId = nextSessionId
            },
        }
    }

    handleEvent(event: OpencodeRuntimeEvent): void {
        const observation = normalizeExecutionObservation(event)
        if (observation === null) {
            return
        }

        if ("sessionId" in observation) {
            this.dispatchToSession(observation.sessionId, observation)
            return
        }

        for (const drivers of this.activeDrivers.values()) {
            for (const driver of drivers.values()) {
                this.publishDirective(driver, driver.driver.observeEvent(observation, monotonicNowMs()))
            }
        }
    }

    private dispatchToSession(sessionId: string, observation: BindingExecutionObservation): void {
        const drivers = this.activeDrivers.get(sessionId)
        if (!drivers) {
            return
        }

        for (const driver of drivers.values()) {
            this.publishDirective(driver, driver.driver.observeEvent(observation, monotonicNowMs()))
        }
    }

    private publishDirective(driver: ActiveDriver, directive: BindingProgressiveDirective): void {
        if (directive.kind !== "preview") {
            return
        }

        void Promise.resolve(
            driver.onPreview({
                processText: directive.processText,
                answerText: directive.answerText,
            }),
        ).catch(() => {
            // Preview delivery must not break the final response path.
        })
    }
}

function monotonicNowMs(): number {
    return Math.trunc(performance.now())
}

function attachDriver(
    activeDrivers: Map<string, Map<number, ActiveDriver>>,
    sessionId: string,
    driverId: number,
    driver: ActiveDriver,
): void {
    let drivers = activeDrivers.get(sessionId)
    if (!drivers) {
        drivers = new Map()
        activeDrivers.set(sessionId, drivers)
    }

    drivers.set(driverId, driver)
}

function detachDriver(
    activeDrivers: Map<string, Map<number, ActiveDriver>>,
    sessionId: string,
    driverId: number,
): void {
    const drivers = activeDrivers.get(sessionId)
    if (!drivers) {
        return
    }

    drivers.delete(driverId)
    if (drivers.size === 0) {
        activeDrivers.delete(sessionId)
    }
}
