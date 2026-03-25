import { Database } from "bun:sqlite"

import type { SqliteDatabaseLike, SqliteQueryStatementLike } from "../store/database"

export function createMemoryDatabase(): SqliteDatabaseLike {
    const db = new Database(":memory:")

    return {
        exec(source: string): void {
            db.exec(source)
        },
        query<Row, Params extends unknown[]>(source: string): SqliteQueryStatementLike<Row, Params> {
            const statement = db.query<Row, Params>(source)

            return {
                get(...params: Params) {
                    return statement.get(...params)
                },
                all(...params: Params) {
                    return statement.all(...params)
                },
                run(...params: Params) {
                    return statement.run(...params)
                },
            }
        },
        transaction<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
            return db.transaction((...args: Args) => handler(...args))
        },
        close(): void {
            db.close()
        },
    }
}
