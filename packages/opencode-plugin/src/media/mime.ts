import { open } from "node:fs/promises"

const FALLBACK_MIME_TYPE = "application/octet-stream"

export async function inferLocalFileMimeType(filePath: string): Promise<string> {
    const bunMimeType = Bun.file(filePath).type.trim()
    if (bunMimeType.length > 0 && bunMimeType !== FALLBACK_MIME_TYPE) {
        return bunMimeType
    }

    const header = await readFileHeader(filePath, 16)
    return inferImageMimeTypeFromHeader(header) ?? (bunMimeType.length > 0 ? bunMimeType : FALLBACK_MIME_TYPE)
}

export function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith("image/")
}

async function readFileHeader(filePath: string, length: number): Promise<Uint8Array> {
    const file = await open(filePath, "r")

    try {
        const buffer = new Uint8Array(length)
        const result = await file.read(buffer, 0, length, 0)
        return buffer.subarray(0, result.bytesRead)
    } finally {
        await file.close()
    }
}

function inferImageMimeTypeFromHeader(header: Uint8Array): string | null {
    if (matchesPrefix(header, [0xff, 0xd8, 0xff])) {
        return "image/jpeg"
    }

    if (matchesPrefix(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return "image/png"
    }

    if (matchesAsciiPrefix(header, "GIF87a") || matchesAsciiPrefix(header, "GIF89a")) {
        return "image/gif"
    }

    if (matchesAsciiPrefix(header, "RIFF") && matchesAsciiPrefix(header.subarray(8), "WEBP")) {
        return "image/webp"
    }

    return null
}

function matchesPrefix(header: Uint8Array, prefix: number[]): boolean {
    return prefix.every((byte, index) => header[index] === byte)
}

function matchesAsciiPrefix(header: Uint8Array, prefix: string): boolean {
    return prefix.split("").every((char, index) => header[index] === char.charCodeAt(0))
}
