import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { DEFAULTS, embeddingSignature, type Config } from "../src/config.ts"
import type { PluginContext } from "../src/context.ts"
import type { EmbedFn } from "../src/embedding.ts"
import { setEmbedder } from "../src/embedding.ts"
import { clearStoreCache } from "../src/store.ts"
import type { Memory } from "../src/types.ts"

export const TEST_MODEL = "test/fake-embedder"

/** What tmpConfig()'s signature resolves to, so fixtures count as current. */
export const TEST_SIGNATURE = embeddingSignature({
	...DEFAULTS,
	embeddingModel: TEST_MODEL,
	queryPrefix: "",
} as Config)

/** A fresh storage root plus a config pointing at it. */
export function tmpConfig(overrides: Partial<Config> = {}): Config {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-memory-test-"))
	return {
		...DEFAULTS,
		dir,
		embeddingModel: TEST_MODEL,
		queryPrefix: "",
		// Keep lock contention tests fast.
		lockRetries: 2,
		lockRetryMs: 1,
		...overrides,
	}
}

export const cleanup = (config: Config) => fs.rmSync(config.dir, { recursive: true, force: true })

// Wide enough that unrelated short texts do not collide into a false match.
const DIM = 256

/**
 * Deterministic bag-of-words embedder: identical text scores 1.0, unrelated
 * text scores near 0. Avoids downloading a real model in tests.
 */
export const fakeEmbed: EmbedFn = async (text) => {
	const v = new Array<number>(DIM).fill(0)
	for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
		let h = 0
		for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0
		v[h % DIM] += 1
	}
	const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
	return v.map((x) => x / norm)
}

// Keyed by the same signature the plugin looks up, not just the model name.
export const useEmbedder = (config: Config) => setEmbedder(embeddingSignature(config), fakeEmbed)
export const useBrokenEmbedder = (config: Config) => setEmbedder(embeddingSignature(config), null)

export const resetCaches = () => clearStoreCache()

export const memory = (overrides: Partial<Memory> = {}): Memory => ({
	id: "memory-id",
	content: "Use pnpm for package management",
	type: "preference",
	tags: ["packages"],
	pinned: false,
	createdAt: Date.now(),
	updatedAt: Date.now(),
	embedding: [1, 0],
	embeddingModel: TEST_SIGNATURE,
	...overrides,
})

export const writeStore = (file: string, memories: Memory[]) => {
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, JSON.stringify({ version: 1, memories }))
	clearStoreCache()
}

export const ctxFor = (config: Config, worktree = config.dir): PluginContext => ({
	config,
	worktree,
	log: () => {},
})

/** Minimal ToolContext: the tools only read `worktree`. */
export const toolCtx = (worktree: string) =>
	({
		sessionID: "ses_test",
		messageID: "msg_test",
		agent: "test",
		directory: worktree,
		worktree,
		abort: new AbortController().signal,
		metadata: () => {},
		ask: async () => {},
	}) as never
