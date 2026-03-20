export function formatUnixMsAsUtc(value: number): string {
    return new Date(value).toISOString()
}
