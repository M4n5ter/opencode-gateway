import BetterSqlite3 from "better-sqlite3"

type SqliteValue = string | number | bigint | Uint8Array | null

export type SqliteQueryStatementLike<Row, Params extends unknown[]> = {
    get(...params: Params): Row | undefined
    all(...params: Params): Row[]
    run(...params: Params): {
        changes: number
        lastInsertRowid: bigint | number
    }
}

export type SqliteDatabaseLike = {
    exec(source: string): void
    query<Row, Params extends unknown[]>(source: string): SqliteQueryStatementLike<Row, Params>
    transaction<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result
    close(): void
}

export class SqliteDatabase implements SqliteDatabaseLike {
    private readonly db: BetterSqlite3.Database

    constructor(path: string) {
        this.db = new BetterSqlite3(path)
    }

    exec(source: string): void {
        this.db.exec(source)
    }

    query<Row, Params extends unknown[]>(source: string): SqliteQueryStatementLike<Row, Params> {
        const statement = this.db.prepare(source)

        return {
            get: (...params) => statement.get(...toSqliteParams(params)) as Row | undefined,
            all: (...params) => statement.all(...toSqliteParams(params)) as Row[],
            run: (...params) => {
                const result = statement.run(...toSqliteParams(params))

                return {
                    changes: result.changes,
                    lastInsertRowid: result.lastInsertRowid,
                }
            },
        }
    }

    transaction<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
        return this.db.transaction((...args: Args) => handler(...args))
    }

    close(): void {
        this.db.close()
    }
}

function toSqliteParams(params: unknown[]): SqliteValue[] {
    return params.map((param) => {
        if (
            param === null ||
            typeof param === "string" ||
            typeof param === "number" ||
            typeof param === "bigint" ||
            param instanceof Uint8Array
        ) {
            return param
        }

        throw new Error(`unsupported SQLite parameter type: ${typeof param}`)
    })
}
