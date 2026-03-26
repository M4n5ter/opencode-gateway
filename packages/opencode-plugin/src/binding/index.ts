import { access, readFile } from "node:fs/promises"

import type { BindingCronJobSpec, BindingInboundMessage, BindingPreparedExecution, GatewayContract } from "./gateway"
import type { BindingOpencodeExecutionInput, OpencodeExecutionDriver } from "./opencode"

export type {
    BindingExecutionObservation,
    BindingExecutionPartKind,
    BindingProgressiveDirective,
    BindingProgressivePreview,
} from "./execution"
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

const GENERATED_WASM_ENTRYPOINT_CANDIDATES = [
    new URL("../generated/wasm/pkg/opencode_gateway_ffi.js", import.meta.url),
    new URL("../../generated/wasm/pkg/opencode_gateway_ffi.js", import.meta.url),
]
let cachedBindingModulePromise: Promise<GatewayBindingModule> | null = null

export async function loadGatewayBindingModule(): Promise<GatewayBindingModule> {
    if (cachedBindingModulePromise !== null) {
        return await cachedBindingModulePromise
    }

    cachedBindingModulePromise = loadGatewayBindingModuleOnce()
    return await cachedBindingModulePromise
}

async function loadGatewayBindingModuleOnce(): Promise<GatewayBindingModule> {
    for (const entrypointUrl of GENERATED_WASM_ENTRYPOINT_CANDIDATES) {
        if (!(await canReadFile(entrypointUrl))) {
            continue
        }

        const module = (await import(entrypointUrl.href)) as GatewayBindingModule
        await initializeGatewayBindingModule(module, entrypointUrl)
        return module
    }

    throw new Error(
        `Unable to locate generated gateway wasm entrypoint. Checked: ${GENERATED_WASM_ENTRYPOINT_CANDIDATES.map((candidate) => candidate.pathname).join(", ")}`,
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

async function initializeGatewayBindingModule(module: GatewayBindingModule, entrypointUrl: URL): Promise<void> {
    if (module.initSync === undefined) {
        return
    }

    const wasmUrl = new URL("./opencode_gateway_ffi_bg.wasm", entrypointUrl)
    const wasmBytes = await readFile(wasmUrl)
    module.initSync({ module: wasmBytes })
}
