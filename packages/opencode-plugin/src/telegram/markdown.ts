import { marked, Renderer, type Tokens } from "marked"

const TELEGRAM_HR = "----------"

export function renderTelegramMarkdownHtml(markdown: string): string {
    const source = markdown.trim()
    if (source.length === 0) {
        return ""
    }

    const rendered = marked(source, {
        async: false,
        gfm: true,
        renderer: createTelegramRenderer(),
    })

    return trimRenderedBlock(rendered)
}

export function escapeTelegramHtml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function createTelegramRenderer(): Renderer<string, string> {
    const renderer = new Renderer<string, string>()

    renderer.space = () => ""

    renderer.paragraph = function ({ tokens }) {
        return `${this.parser.parseInline(tokens)}\n\n`
    }

    renderer.text = function (token) {
        if ("tokens" in token && token.tokens !== undefined) {
            return this.parser.parseInline(token.tokens)
        }

        return escapeTelegramHtml(token.text)
    }

    renderer.strong = function ({ tokens }) {
        return `<b>${this.parser.parseInline(tokens)}</b>`
    }

    renderer.em = function ({ tokens }) {
        return `<i>${this.parser.parseInline(tokens)}</i>`
    }

    renderer.del = function ({ tokens }) {
        return `<s>${this.parser.parseInline(tokens)}</s>`
    }

    renderer.codespan = ({ text }) => `<code>${escapeTelegramHtml(text)}</code>`

    renderer.br = () => "\n"

    renderer.heading = function ({ tokens }) {
        return `<b>${this.parser.parseInline(tokens)}</b>\n\n`
    }

    renderer.hr = () => `${TELEGRAM_HR}\n\n`

    renderer.blockquote = function ({ tokens }) {
        const content = trimRenderedBlock(this.parser.parse(tokens))
        return content.length === 0 ? "" : `<blockquote>${content}</blockquote>\n\n`
    }

    renderer.link = function ({ href, tokens }) {
        const body = this.parser.parseInline(tokens)
        const safeHref = sanitizeHref(href)
        return safeHref === null ? body : `<a href="${escapeTelegramHtmlAttribute(safeHref)}">${body}</a>`
    }

    renderer.image = ({ href, text }) => {
        const label = text.trim().length > 0 ? text : href
        const safeHref = sanitizeHref(href)
        const escapedLabel = escapeTelegramHtml(label)
        return safeHref === null
            ? escapedLabel
            : `<a href="${escapeTelegramHtmlAttribute(safeHref)}">${escapedLabel}</a>`
    }

    renderer.code = ({ text, lang }) => renderCodeBlock(text, lang)

    renderer.list = function (token) {
        const start = token.ordered && token.start !== "" ? Number(token.start) : 1
        const body = token.items
            .map((item, index) =>
                renderListItem(
                    trimRenderedBlock(this.parser.parse(item.tokens)),
                    token.ordered ? `${start + index}. ` : "• ",
                ),
            )
            .join("\n")

        return body.length === 0 ? "" : `${body}\n\n`
    }

    renderer.checkbox = ({ checked }) => (checked ? "[x] " : "[ ] ")

    renderer.table = (token) => renderTable(token)

    renderer.html = ({ text }) => escapeTelegramHtml(text)

    return renderer
}

function renderCodeBlock(text: string, lang: string | undefined): string {
    const escapedText = escapeTelegramHtml(text.replace(/\n+$/u, ""))
    const safeLanguage = sanitizeLanguage(lang)
    if (safeLanguage === null) {
        return `<pre>${escapedText}</pre>\n\n`
    }

    return `<pre><code class="language-${safeLanguage}">${escapedText}</code></pre>\n\n`
}

function renderListItem(body: string, marker: string): string {
    if (body.length === 0) {
        return marker.trimEnd()
    }

    const lines = body.split("\n")
    const [firstLine, ...restLines] = lines
    if (restLines.length === 0) {
        return `${marker}${firstLine}`
    }

    return `${marker}${firstLine}\n${restLines.map((line) => (line.length === 0 ? line : `  ${line}`)).join("\n")}`
}

function renderTable(token: Tokens.Table): string {
    const rows = [
        token.header.map((cell) => cell.text.trim()),
        token.header.map(() => "---"),
        ...token.rows.map((row) => row.map((cell) => cell.text.trim())),
    ]

    const body = rows.map((row) => row.join(" | ")).join("\n")
    return body.length === 0 ? "" : `<pre>${escapeTelegramHtml(body)}</pre>\n\n`
}

function sanitizeHref(href: string): string | null {
    try {
        const parsed = new URL(href)
        return isSupportedTelegramHrefProtocol(parsed.protocol) ? parsed.toString() : null
    } catch {
        return null
    }
}

function isSupportedTelegramHrefProtocol(protocol: string): boolean {
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tg:"
}

function sanitizeLanguage(value: string | undefined): string | null {
    if (value === undefined) {
        return null
    }

    const normalized = value.trim()
    if (normalized.length === 0) {
        return null
    }

    return /^[A-Za-z0-9_+-]+$/u.test(normalized) ? normalized : null
}

function escapeTelegramHtmlAttribute(text: string): string {
    return escapeTelegramHtml(text).replaceAll('"', "&quot;")
}

function trimRenderedBlock(rendered: string): string {
    return rendered.replace(/^\n+/u, "").replace(/\n+$/u, "")
}
