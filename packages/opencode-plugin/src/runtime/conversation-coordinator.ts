export class ConversationCoordinator {
    private readonly tails = new Map<string, Promise<void>>()

    async runExclusive<T>(conversationKey: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(conversationKey) ?? Promise.resolve()
        let release!: () => void
        const current = new Promise<void>((resolve) => {
            release = resolve
        })
        const tail = previous.then(
            () => current,
            () => current,
        )

        this.tails.set(conversationKey, tail)

        await previous

        try {
            return await operation()
        } finally {
            release()
            if (this.tails.get(conversationKey) === tail) {
                this.tails.delete(conversationKey)
            }
        }
    }
}
