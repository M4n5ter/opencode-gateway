import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingHandle, GatewayBindingModule } from "./binding"
import { ConsoleLoggerHost, NoopStoreHost, NoopTransportHost, SystemClockHost } from "./host/noop"
import { GatewayOpencodeHost } from "./host/opencode"

export function createGatewayBinding(module: GatewayBindingModule, input: PluginInput): GatewayBindingHandle {
    return module.GatewayBinding.new(
        new NoopStoreHost(),
        new GatewayOpencodeHost(input.client, input.directory),
        new NoopTransportHost(),
        new SystemClockHost(),
        new ConsoleLoggerHost(),
    )
}
