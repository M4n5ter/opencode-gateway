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

type BetterSqlite3Module = {
    default: new (path: string) => BetterSqlite3DatabaseLike
}

type BetterSqlite3DatabaseLike = {
    exec(source: string): void
    prepare(source: string): BetterSqlite3StatementLike
    transaction<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result
    close(): void
}

type BetterSqlite3StatementLike = {
    get(...params: SqliteValue[]): unknown
    all(...params: SqliteValue[]): unknown[]
    run(...params: SqliteValue[]): {
        changes: number
        lastInsertRowid: bigint | number
    }
}

type BunSqliteModule = {
    Database: new (path: string) => BunSqliteDatabaseLike
}

type BunSqliteDatabaseLike = {
    exec(source: string): void
    query<Row, Params extends unknown[]>(source: string): BunSqliteStatementLike<Row, Params>
    transaction<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result
    close(): void
}

type BunSqliteStatementLike<Row, Params extends unknown[]> = {
    get(...params: Params): Row | undefined
    all(...params: Params): Row[]
    run(...params: Params): {
        changes: number
        lastInsertRowid: bigint | number
    }
}

const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>

export async function openRuntimeSqliteDatabase(path: string): Promise<SqliteDatabaseLike> {
    if (isBunRuntime()) {
        return await openBunSqliteDatabase(path)
    }

    return await openNodeSqliteDatabase(path)
}

async function openNodeSqliteDatabase(path: string): Promise<SqliteDatabaseLike> {
    const module = (await dynamicImport("better-sqlite3")) as BetterSqlite3Module
    const db = new module.default(path)

    return {
        exec(source: string): void {
            db.exec(source)
        },
        query<Row, Params extends unknown[]>(source: string): SqliteQueryStatementLike<Row, Params> {
            const statement = db.prepare(source)

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
        },
        transaction<Args extends unknown[], Result>(handler: (...args: Args) => Result): (...args: Args) => Result {
            return db.transaction((...args: Args) => handler(...args))
        },
        close(): void {
            db.close()
        },
    }
}

async function openBunSqliteDatabase(path: string): Promise<SqliteDatabaseLike> {
    const module = (await dynamicImport("bun:sqlite")) as BunSqliteModule
    const db = new module.Database(path)

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

function isBunRuntime(): boolean {
    return typeof globalThis === "object" && globalThis !== null && "Bun" in globalThis
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
