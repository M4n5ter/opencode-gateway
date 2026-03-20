export function formatUnixMsAsUtc(value: number): string {
    return new Date(value).toISOString()
}

export function formatOptionalUnixMsAsUtc(value: number | null): string {
    return value === null ? "none" : formatUnixMsAsUtc(value)
}
