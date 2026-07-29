/**
 * Exercises the real out-of-process embedder path: a spawned process, the
 * handshake, and stdio framing. A stub interpreter stands in for bun so no
 * model is loaded; see fixtures/embedder-runtime.sh.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULTS, resolveConfig, type Config } from "../src/config.ts"
import { embed, embedIfReady, isEmbedderReady, resetEmbedders, setEmbedderLogger } from "../src/embedding.ts"

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")
const runtime = path.join(fixtures, "embedder-runtime.sh")

let warnings: string[] = []

const configFor = (mode: string, overrides: Partial<Config> = {}): Config => {
	process.env.FAKE_EMBEDDER_MODE = mode
	return { ...DEFAULTS, embeddingModel: `test/${mode}`, queryPrefix: "Q:", documentPrefix: "D:", ...overrides }
}

beforeEach(() => {
	fs.chmodSync(runtime, 0o755)
	process.env.OPENCODE_MEMORY_RUNTIME = runtime
	process.env.FAKE_EMBEDDER_BUN = process.execPath
	process.env.FAKE_EMBEDDER_WORKER = path.join(fixtures, "fake-embedder-worker.ts")
	warnings = []
	setEmbedderLogger((message) => warnings.push(message))
})

afterEach(() => {
	resetEmbedders()
	setEmbedderLogger(() => {})
	delete process.env.OPENCODE_MEMORY_RUNTIME
	delete process.env.FAKE_EMBEDDER_BUN
	delete process.env.FAKE_EMBEDDER_WORKER
	delete process.env.FAKE_EMBEDDER_MODE
})

describe("out-of-process embedder", () => {
	test("embeds through a spawned worker", async () => {
		const config = configFor("ready")
		// "D:" + "hello", the document prefix applied inside the worker.
		const vector = await embed(config, "hello", false)
		expect(vector).toEqual([7, expect.any(Number), 0])
	})

	test("passes the query and document prefixes to the worker", async () => {
		const config = configFor("ready")
		const asQuery = await embed(config, "hello", true)
		const asDocument = await embed(config, "hello", false)
		// The worker reports prefixed length and which prefix it applied.
		expect(asQuery?.[2]).toBe(1)
		expect(asDocument?.[2]).toBe(0)
		expect(asQuery?.[0]).toBe(7)
	})

	test("reuses one worker across calls", async () => {
		const config = configFor("ready")
		expect(isEmbedderReady(config)).toBe(false)
		await embed(config, "first", false)
		expect(isEmbedderReady(config)).toBe(true)
		expect(await embed(config, "second", false)).not.toBeNull()
	})

	test("reports a per-request failure as no vector", async () => {
		const config = configFor("ready")
		expect(await embed(config, "__fail__", false)).toBeNull()
		// The worker stays usable after a failed request.
		expect(await embed(config, "fine", false)).not.toBeNull()
	})

	test("falls back to keywords and warns when the model cannot load", async () => {
		const config = configFor("fail-load")
		expect(await embed(config, "hello", false)).toBeNull()
		expect(isEmbedderReady(config)).toBe(false)
		expect(warnings.join()).toContain("fake load failure")
	})

	test("does not retry a failed load on every call", async () => {
		const config = configFor("fail-load")
		await embed(config, "hello", false)
		const afterFirst = warnings.length
		await embed(config, "hello", false)
		expect(warnings.length).toBe(afterFirst)
	})

	test("retries once the backoff has passed", async () => {
		const config = configFor("fail-load", { embedderRetryMs: 0 })
		await embed(config, "hello", false)
		const afterFirst = warnings.length
		await embed(config, "hello", false)
		expect(warnings.length).toBeGreaterThan(afterFirst)
	})

	test("forgets a worker that exits, so the next call starts a new one", async () => {
		const config = configFor("exit-early")
		await embed(config, "hello", false)
		expect(isEmbedderReady(config)).toBe(false)
	})

	test("embedIfReady never waits for a cold worker", async () => {
		const config = configFor("ready")
		expect(await embedIfReady(config, "hello", true)).toBeNull()
	})
})

describe("embedderIdleMs", () => {
	test("has a default and is clamped to its bounds", () => {
		expect(DEFAULTS.embedderIdleMs).toBe(30 * 60 * 1000)
		const { config, warnings: w } = resolveConfig({ embedderIdleMs: 1 })
		expect(config.embedderIdleMs).toBe(10_000)
		expect(w.join()).toContain("embedderIdleMs")
	})
})
