/**
 * Loads the built plugin the way OpenCode loads it from npm. This catches emit
 * and packaging problems that a type check cannot see, most importantly
 * relative specifiers that still point at `.ts` files.
 *
 * OpenCode resolves a server plugin from `exports["./server"]` and falls back
 * to `main`. It never reads `exports["."]`, so both entries are checked here.
 *
 * The plugin function is deliberately not called. Invoking it would start the
 * background model download.
 */
import { access, readFile } from "node:fs/promises"

const root = new URL("../", import.meta.url)
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"))

const entries = {
	"exports[\"./server\"]": pkg.exports?.["./server"]?.import,
	"exports[\".\"]": pkg.exports?.["."]?.import,
	main: pkg.main,
}

for (const [field, value] of Object.entries(entries)) {
	if (typeof value !== "string") throw new Error(`package.json is missing ${field}`)
	await access(new URL(value, root)).catch(() => {
		throw new Error(`${field} points at ${value}, which is not in the build output`)
	})
}

const module = await import(new URL(entries['exports["./server"]'] as string, root).href)
const plugin = module.default

if (typeof plugin !== "object" || plugin === null) {
	throw new Error("the server entry point has no default export")
}
if (typeof plugin.id !== "string" || plugin.id.length === 0) {
	throw new Error("the default export is missing a plugin id")
}
if (typeof plugin.server !== "function") {
	throw new Error("the default export is missing a server plugin function")
}
if (typeof module.MemoryPlugin !== "function") {
	throw new Error("the named MemoryPlugin export is missing")
}

console.log(`ok: ${pkg.name}@${pkg.version} exposes plugin "${plugin.id}"`)
