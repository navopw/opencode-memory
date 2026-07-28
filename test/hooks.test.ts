import { afterEach, describe, expect, test } from "bun:test"
import { createHooks } from "../src/hooks.ts"
import { clearPromptCache } from "../src/prompt.ts"
import { embeddingSignature } from "../src/config.ts"
import { clearStoreCache, globalPath, loadStore, roundVector } from "../src/store.ts"
import type { Memory } from "../src/types.ts"
import {
	cleanup,
	ctxFor,
	fakeEmbed,
	memory,
	tmpConfig,
	useBrokenEmbedder,
	useEmbedder,
	writeStore,
} from "./helpers.ts"

const configs: ReturnType<typeof tmpConfig>[] = []
const freshConfig = (...args: Parameters<typeof tmpConfig>) => {
	const config = tmpConfig(...args)
	configs.push(config)
	return config
}

afterEach(() => {
	while (configs.length) cleanup(configs.pop()!)
	clearStoreCache()
	clearPromptCache()
})

/** Builds a memory whose vector matches what the fake embedder produces. */
const embedded = async (overrides: Partial<Memory>): Promise<Memory> => {
	const base = memory(overrides)
	return { ...base, embedding: roundVector(await fakeEmbed(base.content, false)) }
}

type Parts = { type: string; text: string; synthetic?: boolean }[]

const runMessage = async (
	hooks: ReturnType<typeof createHooks>,
	text: string,
	opts: { sessionID?: string; extraParts?: Parts } = {},
) => {
	const sessionID = opts.sessionID ?? "ses_1"
	const parts: Parts = [{ type: "text", text }, ...(opts.extraParts ?? [])]
	const output = { message: { id: "msg_1" }, parts }
	await (hooks["chat.message"] as any)({ sessionID, messageID: "msg_1" }, output)
	return output.parts
}

const injected = (parts: Parts) => parts.find((p) => p.text?.includes("<memory-context>"))?.text

describe("system prompt hook", () => {
	test("appends the memory block, and nothing when the store is empty", async () => {
		const config = freshConfig()
		const empty = { system: [] as string[] }
		const run = async (out: { system: string[] }) =>
			(createHooks(ctxFor(config))["experimental.chat.system.transform"] as any)({}, out)

		await run(empty)
		expect(empty.system).toHaveLength(0)

		writeStore(globalPath(config.dir), [memory()])
		const filled = { system: [] as string[] }
		await run(filled)
		expect(filled.system[0]).toContain("## Persistent memory")
	})
})

describe("message hook", () => {
	test("injects a semantically relevant memory", async () => {
		const config = freshConfig()
		useEmbedder(config)
		writeStore(globalPath(config.dir), [await embedded({ content: "Deploys go through the staging cluster first" })])

		const parts = await runMessage(createHooks(ctxFor(config)), "Deploys go through the staging cluster first")
		expect(injected(parts)).toContain("staging cluster")
	})

	test("ignores memories that are not relevant to the message", async () => {
		const config = freshConfig()
		useEmbedder(config)
		writeStore(globalPath(config.dir), [await embedded({ content: "Deploys go through the staging cluster first" })])

		const parts = await runMessage(createHooks(ctxFor(config)), "what colour is the bikeshed")
		expect(injected(parts)).toBeUndefined()
	})

	test("does not re-inject the same memory until the cooldown passes", async () => {
		const config = freshConfig({ reinjectAfterTurns: 3 })
		useEmbedder(config)
		writeStore(globalPath(config.dir), [await embedded({ content: "Deploys go through the staging cluster first" })])
		const hooks = createHooks(ctxFor(config))
		const ask = () => runMessage(hooks, "Deploys go through the staging cluster first")

		expect(injected(await ask())).toBeDefined()
		expect(injected(await ask())).toBeUndefined()
		expect(injected(await ask())).toBeUndefined()
		expect(injected(await ask())).toBeDefined()
	})

	test("tracks the cooldown per session", async () => {
		const config = freshConfig()
		useEmbedder(config)
		writeStore(globalPath(config.dir), [await embedded({ content: "Deploys go through the staging cluster first" })])
		const hooks = createHooks(ctxFor(config))
		const text = "Deploys go through the staging cluster first"

		expect(injected(await runMessage(hooks, text, { sessionID: "a" }))).toBeDefined()
		expect(injected(await runMessage(hooks, text, { sessionID: "a" }))).toBeUndefined()
		expect(injected(await runMessage(hooks, text, { sessionID: "b" }))).toBeDefined()
	})

	test("nudges towards memory_save when the user asks to remember something", async () => {
		const config = freshConfig()
		useBrokenEmbedder(config)
		const parts = await runMessage(createHooks(ctxFor(config)), "remember that I prefer tabs")
		expect(parts.some((p) => p.text.includes("memory_save"))).toBe(true)
	})

	test("does not treat its own injected parts as user input", async () => {
		const config = freshConfig()
		useBrokenEmbedder(config)
		writeStore(globalPath(config.dir), [memory({ content: "bikeshed colour is green", embedding: [] })])

		const parts = await runMessage(createHooks(ctxFor(config)), "unrelated question", {
			extraParts: [{ type: "text", text: "bikeshed colour", synthetic: true }],
		})
		expect(injected(parts)).toBeUndefined()
	})

	test("still retrieves by keyword while the model is unavailable", async () => {
		const config = freshConfig()
		useBrokenEmbedder(config)
		writeStore(globalPath(config.dir), [memory({ content: "Deploys use the staging cluster", embedding: [] })])

		const parts = await runMessage(createHooks(ctxFor(config)), "how do deploys reach the staging cluster")
		expect(injected(parts)).toContain("staging cluster")
	})

	test("does not stall the turn while the model is still loading", async () => {
		// Regression: waiting on the model load here cost every message the full
		// hook timeout until the download finished.
		const config = freshConfig({ hookTimeoutMs: 5000 })
		useBrokenEmbedder(config)
		writeStore(globalPath(config.dir), [memory({ content: "Deploys use the staging cluster", embedding: [] })])

		const started = Date.now()
		await runMessage(createHooks(ctxFor(config)), "how do deploys reach the staging cluster")
		expect(Date.now() - started).toBeLessThan(1000)
	})

	test("backfills vectors for memories saved while the model was unavailable", async () => {
		// Regression: these score 0 on cosine forever, so without a backfill they
		// drop out of injection permanently once the model comes back.
		const config = freshConfig()
		useEmbedder(config)
		const file = globalPath(config.dir)
		writeStore(file, [memory({ content: "Deploys use the staging cluster", embedding: [], embeddingModel: null })])

		await runMessage(createHooks(ctxFor(config)), "how do deploys reach the staging cluster")

		for (let i = 0; i < 50 && !loadStore(file, config).data.memories[0].embedding.length; i++) {
			clearStoreCache()
			await new Promise((r) => setTimeout(r, 20))
		}
		const stored = loadStore(file, config).data.memories[0]
		expect(stored.embedding.length).toBeGreaterThan(0)
		expect(stored.embeddingModel).toBe(embeddingSignature(config))
	})

	test("never injects pinned memories, which are already in the system prompt", async () => {
		const config = freshConfig()
		useEmbedder(config)
		writeStore(globalPath(config.dir), [
			await embedded({ content: "Deploys go through the staging cluster first", pinned: true }),
		])

		const parts = await runMessage(createHooks(ctxFor(config)), "Deploys go through the staging cluster first")
		expect(injected(parts)).toBeUndefined()
	})

	test("caps injection at topK", async () => {
		const config = freshConfig({ topK: 2 })
		useEmbedder(config)
		writeStore(
			globalPath(config.dir),
			await Promise.all(
				[1, 2, 3, 4].map((i) =>
					embedded({ id: `m${i}`, content: `Deploys go through the staging cluster in region ${i}` }),
				),
			),
		)

		const parts = await runMessage(createHooks(ctxFor(config)), "deploys staging cluster region")
		expect(injected(parts)!.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2)
	})
})
