import { access } from "node:fs/promises"

import type { BindingCronJobSpec, BindingInboundMessage, BindingPreparedExecution, GatewayContract } from "./gateway"
import type { BindingOpencodeExecutionInput, OpencodeExecutionDriver } from "./opencode"

export type { BindingExecutionObservation, BindingProgressiveDirective } from "./execution"
export type {
    BindingCronJobSpec,
    BindingDeliveryTarget,
    BindingHostAck,
    BindingInboundAttachment,
    BindingInboundMessage,
    BindingLoggerHost,
    BindingLogLevel,
    BindingOutboundMessage,
    BindingPreparedExecution,
    BindingPromptPart,
    BindingRuntimeReport,
    BindingTransportHost,
    GatewayContract,
    GatewayStatusSnapshot,
} from "./gateway"
export type {
    BindingOpencodeCommand,
    BindingOpencodeCommandPart,
    BindingOpencodeCommandResult,
    BindingOpencodeDriverStep,
    BindingOpencodeExecutionInput,
    BindingOpencodeMessage,
    BindingOpencodeMessagePart,
    BindingOpencodePrompt,
    OpencodeExecutionDriver,
} from "./opencode"

export type GatewayBindingModule = GatewayContract & {
    prepareInboundExecution: (message: BindingInboundMessage) => BindingPreparedExecution
    prepareCronExecution: (job: BindingCronJobSpec) => BindingPreparedExecution
    OpencodeExecutionDriver: {
        new (input: BindingOpencodeExecutionInput): OpencodeExecutionDriver
    }
    initSync?: (module?: BufferSource | WebAssembly.Module) => unknown
    default?: (module?: BufferSource | WebAssembly.Module) => Promise<unknown>
}

const GENERATED_NODE_ENTRYPOINT_CANDIDATES = [
    new URL("../generated/wasm/pkg/opencode_gateway_ffi.js", import.meta.url),
    new URL("../../generated/wasm/pkg/opencode_gateway_ffi.js", import.meta.url),
]

export async function loadGatewayBindingModule(): Promise<GatewayBindingModule> {
    for (const candidate of GENERATED_NODE_ENTRYPOINT_CANDIDATES) {
        if (await canReadFile(candidate)) {
            return (await import(candidate.href)) as GatewayBindingModule
        }
    }

    throw new Error(
        `Unable to locate generated gateway wasm entrypoint. Checked: ${GENERATED_NODE_ENTRYPOINT_CANDIDATES.map((candidate) => candidate.pathname).join(", ")}`,
    )
}

async function canReadFile(candidate: URL): Promise<boolean> {
    try {
        await access(candidate)
        return true
    } catch {
        return false
    }
}
