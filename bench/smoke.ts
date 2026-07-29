/**
 * End-to-end check against the real default model: saves through the actual
 * tool, then recalls with an English and a German paraphrase. Run after
 * changing the default model or its profile.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { strict as assert } from "node:assert"
import { DEFAULTS, embeddingSignature } from "../src/config.ts"
import { resetEmbedders } from "../src/embedding.ts"
import { createHooks } from "../src/hooks.ts"
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

try {
	console.log(`model: ${config.embeddingModel}`)
	console.log(`pooling: ${config.pooling}  injectThreshold: ${config.injectThreshold}`)
	console.log(`signature: ${embeddingSignature(config)}\n`)

	console.log(await call("memory_save", { content: "This project uses pnpm as its package manager" }))
	console.log(await call("memory_save", { content: "Deployments go to the staging cluster first" }))

	const stored = loadStore(projectPath(config, worktree), config).data.memories
	const signatureMatches = stored.every((m) => m.embeddingModel === embeddingSignature(config))
	console.log(`\nstored ${stored.length}, vector dims ${stored[0]?.embedding.length}`)
	console.log(`signature match: ${signatureMatches}\n`)
	assert.equal(stored.length, 2)
	assert.equal(stored[0]?.embedding.length, 384)
	assert(signatureMatches)

	const cases = [
		{ query: "which tool installs dependencies here", expected: "uses pnpm" },
		{ query: "welchen paketmanager nutzt dieses projekt", expected: "uses pnpm" },
		{ query: "which environment receives a deployment before production", expected: "staging cluster" },
		{ query: "what is the best pizza topping", expected: "No memories found" },
	]

	for (const { query, expected } of cases) {
		const out = await call("memory_recall", { query })
		console.log(`Q: ${query}\n   ${out.split("\n").slice(0, 2).join("\n   ")}\n`)
		assert(
			out.includes(expected),
			`Expected recall for ${JSON.stringify(query)} to include ${JSON.stringify(expected)}`,
		)
	}

	const hooks = createHooks({ config, worktree, log: () => {} })
	const inject = async (query: string, sessionID: string) => {
		const output = { message: { id: `msg_${sessionID}` }, parts: [{ type: "text", text: query }] }
		await (hooks["chat.message"] as any)({ sessionID, messageID: output.message.id }, output)
		return output.parts.find((part) => "synthetic" in part && part.synthetic && part.text.includes("<memory-context>"))
	}

	assert((await inject("welchen paketmanager nutzt dieses projekt", "package"))?.text.includes("uses pnpm"))
	assert(
		(await inject("which environment receives a deployment before production", "deploy"))?.text.includes(
			"staging cluster",
		),
	)
	assert.equal(await inject("what is the best pizza topping", "negative"), undefined)
} finally {
	// The embedder is a separate process; stop it rather than waiting for the
	// closed pipe to be noticed.
	resetEmbedders()
	fs.rmSync(dir, { recursive: true, force: true })
}
