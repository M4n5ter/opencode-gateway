const moduleUrl = new URL("../dist/index.js", import.meta.url)
const moduleExports = await import(moduleUrl.href)

if (typeof moduleExports.default !== "function") {
    throw new Error("published plugin entrypoint does not export a default plugin function")
}
