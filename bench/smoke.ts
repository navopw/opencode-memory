/**
 * End-to-end check against the real default model: saves through the actual
 * tool, then recalls with an English and a German paraphrase. Run after
 * changing the default model or its profile.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { DEFAULTS, embeddingSignature } from "../src/config.ts"
import { createTools } from "../src/tools/index.ts"
import { loadStore, projectPath } from "../src/store.ts"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-memory-smoke-"))
const config = { ...DEFAULTS, dir }
const worktree = dir
const tools = createTools({ config, worktree, log: (l, m) => console.error(`[${l}] ${m}`) })
const ctx = { worktree } as never

const call = async (name: keyof typeof tools, args: unknown) => {
	const r = await tools[name].execute(args as never, ctx)
	return typeof r === "string" ? r : r.output
}

console.log(`model: ${config.embeddingModel}`)
console.log(`pooling: ${config.pooling}  injectThreshold: ${config.injectThreshold}`)
console.log(`signature: ${embeddingSignature(config)}\n`)

console.log(await call("memory_save", { content: "This project uses pnpm as its package manager" }))
console.log(await call("memory_save", { content: "Deployments go to the staging cluster first" }))

const stored = loadStore(projectPath(dir, worktree), config).data.memories
console.log(`\nstored ${stored.length}, vector dims ${stored[0]?.embedding.length}`)
console.log(`signature match: ${stored.every((m) => m.embeddingModel === embeddingSignature(config))}\n`)

for (const q of [
	"which tool installs dependencies here",
	"welchen paketmanager nutzt dieses projekt",
	"how does code reach production",
	"what is the best pizza topping",
]) {
	const out = await call("memory_recall", { query: q })
	console.log(`Q: ${q}\n   ${out.split("\n").slice(0, 2).join("\n   ")}\n`)
}

fs.rmSync(dir, { recursive: true, force: true })
