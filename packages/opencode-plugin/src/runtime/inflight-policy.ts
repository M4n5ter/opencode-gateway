import type { BindingLoggerHost } from "../binding"
import type { SqliteStore } from "../store/sqlite"
import { formatError } from "../utils/error"
import type { GatewayExecutor } from "./executor"

export class GatewayInflightPolicyRuntime {
    constructor(
        private readonly store: SqliteStore,
        private readonly executor: Pick<GatewayExecutor, "requestConversationInterrupt">,
        private readonly logger: BindingLoggerHost,
        private readonly notifyStateChanged: () => void,
    ) {}

    recoverOnStartup(): void {
        this.store.clearLocalInflightInteractions()
        this.store.releaseAllHeldMailboxEntries(Date.now())
    }

    async queueNext(mailboxKey: string): Promise<void> {
        this.store.releaseHeldMailboxEntries(mailboxKey, Date.now())
        this.notifyStateChanged()
    }

    async interruptCurrent(mailboxKey: string): Promise<void> {
        this.store.releaseHeldMailboxEntries(mailboxKey, Date.now())
        try {
            await this.executor.requestConversationInterrupt(mailboxKey)
        } catch (error) {
            this.logger.log("warn", `failed to interrupt mailbox ${mailboxKey}: ${formatError(error)}`)
        }
        this.notifyStateChanged()
    }
}
