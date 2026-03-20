import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { migrateGatewayDatabase } from "../store/migrations"
import { SqliteStore } from "../store/sqlite"
import { GatewayTransportHost } from "./transport"

test("transport host records Telegram send success in kv_state", async () => {
    const db = new Database(":memory:")

    try {
        migrateGatewayDatabase(db)
        const store = new SqliteStore(db)
        const sent: { current: { chatId: string; body: string; topic: string | null } | null } = {
            current: null,
        }
        const host = new GatewayTransportHost(
            {
                async sendMessage(chatId: string, body: string, topic: string | null): Promise<void> {
                    sent.current = { chatId, body, topic }
                },
            },
            store,
        )

        const ack = await host.sendMessage({
            deliveryTarget: {
                channel: "telegram",
                target: "-100123",
                topic: "42",
            },
            body: "hello",
        })

        expect(ack.errorMessage).toBeNull()
        expect(sent.current).toEqual({
            chatId: "-100123",
            body: "hello",
            topic: "42",
        })
        expect(store.getStateValue("telegram.last_send_success_ms")).not.toBeNull()
    } finally {
        db.close()
    }
})
