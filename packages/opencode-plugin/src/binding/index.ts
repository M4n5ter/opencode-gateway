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

const GENERATED_NODE_ENTRYPOINT = new URL("../../generated/wasm/pkg/opencode_gateway_ffi.js", import.meta.url)

export async function loadGatewayBindingModule(): Promise<GatewayBindingModule> {
    return (await import(GENERATED_NODE_ENTRYPOINT.href)) as GatewayBindingModule
}
