import type { BindingDeliveryTarget, GatewayContract } from "../binding"
import type { GatewayMailboxRouter } from "../mailbox/router"

export function resolveConversationKeyForTarget(
    target: BindingDeliveryTarget,
    router: GatewayMailboxRouter,
    contract: Pick<GatewayContract, "conversationKeyForDeliveryTarget">,
): string {
    return router.resolve(target) ?? contract.conversationKeyForDeliveryTarget(target)
}
