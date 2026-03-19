import type { PluginInput } from "@opencode-ai/plugin"

import type { GatewayBindingHandle, GatewayBindingModule } from "./binding"
import { loadGatewayConfig } from "./config/gateway"
import { ConsoleLoggerHost, NoopTransportHost, SystemClockHost } from "./host/noop"
import { GatewayOpencodeHost } from "./host/opencode"
import { SqliteStoreHost } from "./host/store"
import { openSqliteStore } from "./store/sqlite"

export async function createGatewayBinding(
    module: GatewayBindingModule,
    input: PluginInput,
): Promise<GatewayBindingHandle> {
    const config = await loadGatewayConfig()
    const store = await openSqliteStore(config.stateDbPath)

    return module.GatewayBinding.new(
        new SqliteStoreHost(store),
        new GatewayOpencodeHost(input.client, input.directory),
        new NoopTransportHost(),
        new SystemClockHost(),
        new ConsoleLoggerHost(),
    )
}
