import type { BindingHostAck, BindingOutboundMessage, BindingTransportHost } from "../binding"
import type { TelegramBotClient } from "../telegram/client"
import { failedAck, okAck } from "./result"

export class GatewayTransportHost implements BindingTransportHost {
    constructor(private readonly telegramClient: TelegramBotClient | null) {}

    async sendMessage(message: BindingOutboundMessage): Promise<BindingHostAck> {
        try {
            if (message.deliveryTarget.channel !== "telegram") {
                throw new Error(`unsupported outbound channel: ${message.deliveryTarget.channel}`)
            }

            if (this.telegramClient === null) {
                throw new Error("telegram transport is not configured")
            }

            const body = message.body.trim()
            if (body.length === 0) {
                throw new Error("telegram outbound message body must not be empty")
            }

            await this.telegramClient.sendMessage(message.deliveryTarget.target, body, message.deliveryTarget.topic)
            return okAck()
        } catch (error) {
            return failedAck(error)
        }
    }
}
