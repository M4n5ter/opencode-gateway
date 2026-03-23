export function formatUnixMsAsUtc(value: number): string {
    return new Date(value).toISOString()
}

export function formatOptionalUnixMsAsUtc(value: number | null): string {
    return value === null ? "none" : formatUnixMsAsUtc(value)
}

export function formatUnixMsInTimeZone(value: number, timeZone: string): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    })
    const parts = formatter.formatToParts(new Date(value))
    const values = new Map(parts.map((part) => [part.type, part.value]))

    return [
        `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
        `${values.get("hour")}:${values.get("minute")}:${values.get("second")}`,
        `[${timeZone}]`,
    ].join(" ")
}
