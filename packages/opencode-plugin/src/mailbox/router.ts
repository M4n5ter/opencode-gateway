import type { BindingDeliveryTarget } from "../binding"
import type { GatewayMailboxRouteConfig } from "../config/gateway"

export class GatewayMailboxRouter {
    constructor(private readonly routes: GatewayMailboxRouteConfig[]) {}

    resolve(target: BindingDeliveryTarget): string | null {
        for (const route of this.routes) {
            if (
                route.channel === target.channel &&
                route.target === target.target &&
                route.topic === (target.topic ?? null)
            ) {
                return route.mailboxKey
            }
        }

        return null
    }
}
