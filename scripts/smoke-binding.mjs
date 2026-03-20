import { loadGatewayBindingModule } from "../packages/opencode-plugin/src/binding.ts"

function createBindingModuleMocks() {
    return {
        store: {
            async getSessionBinding() {
                return { sessionId: null, errorMessage: null }
            },
            async putSessionBinding() {
                return { errorMessage: null }
            },
            async recordInboundMessage() {
                return { errorMessage: null }
            },
            async recordCronDispatch() {
                return { errorMessage: null }
            },
            async recordDelivery() {
                return { errorMessage: null }
            },
        },
        opencode: {
            async runPrompt(request) {
                return {
                    sessionId: "session-smoke",
                    responseText: `echo:${request.prompt}`,
                    errorMessage: null,
                }
            },
        },
        transport: {
            async sendMessage() {
                return { errorMessage: null }
            },
        },
        clock: {
            nowUnixMs() {
                return 1_234n
            },
        },
        logger: {
            log() {},
        },
    }
}

const module = await loadGatewayBindingModule()
const mocks = createBindingModuleMocks()
if (typeof module.GatewayBinding?.new !== "function") {
    throw new Error("GatewayBinding constructor is unavailable")
}

module.GatewayBinding.new(mocks.store, mocks.opencode, mocks.transport, mocks.clock, mocks.logger)
