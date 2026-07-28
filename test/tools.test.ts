import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { clearStoreCache, globalPath, loadStore, projectPath } from "../src/store.ts"
import { createTools } from "../src/tools/index.ts"
import { cleanup, ctxFor, memory, toolCtx, tmpConfig, useBrokenEmbedder, useEmbedder, writeStore } from "./helpers.ts"

const configs: ReturnType<typeof tmpConfig>[] = []

afterEach(() => {
	while (configs.length) cleanup(configs.pop()!)
	clearStoreCache()
})

function setup(overrides: Parameters<typeof tmpConfig>[0] = {}) {
	const config = tmpConfig(overrides)
	configs.push(config)
	const tools = createTools(ctxFor(config))
	const worktree = config.dir
	const call = async <K extends keyof typeof tools>(
		name: K,
		args: Parameters<(typeof tools)[K]["execute"]>[0],
	): Promise<string> => {
		const result = await tools[name].execute(args as never, toolCtx(worktree))
		return typeof result === "string" ? result : result.output
	}
	return { config, worktree, call }
}

describe("memory_save", () => {
	test("saves, then finds it again through memory_recall", async () => {
		useEmbedder()
		const { call } = setup()

		const saved = await call("memory_save", { content: "The deploy pipeline runs on Buildkite", type: "fact" })
		expect(saved).toContain("Saved project memory")

		const found = await call("memory_recall", { query: "where does the deploy pipeline run" })
		expect(found).toContain("Buildkite")
	})

	test("routes global and project scopes to different stores", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()

		await call("memory_save", { content: "Prefers tabs over spaces", scope: "global" })
		await call("memory_save", { content: "This repo uses Bun", scope: "project" })

		expect(loadStore(globalPath(config.dir), config).data.memories).toHaveLength(1)
		expect(loadStore(projectPath(config.dir, worktree), config).data.memories).toHaveLength(1)
	})

	test("updates in place instead of duplicating identical content", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()

		await call("memory_save", { content: "Prefers tabs", tags: ["style"] })
		const again = await call("memory_save", { content: "  prefers   TABS  ", tags: ["formatting"] })

		expect(again).toContain("Updated existing")
		const stored = loadStore(projectPath(config.dir, worktree), config).data.memories
		expect(stored).toHaveLength(1)
		expect(stored[0].tags.sort()).toEqual(["formatting", "style"])
	})

	test("refuses a near-duplicate and points at the existing memory", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()

		const first = await call("memory_save", { content: "Prefers dark mode" })
		const id = first.match(/memory (\S+):/)![1]

		const second = await call("memory_save", { content: "Prefers dark mode!" })
		expect(second).toContain("Not saved")
		expect(second).toContain(id)
		expect(second).toContain("memory_update")
		expect(loadStore(projectPath(config.dir, worktree), config).data.memories).toHaveLength(1)
	})

	test("force overrides the near-duplicate check", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()

		await call("memory_save", { content: "Prefers dark mode" })
		const forced = await call("memory_save", { content: "Prefers dark mode!", force: true })

		expect(forced).toContain("Saved project memory")
		expect(loadStore(projectPath(config.dir, worktree), config).data.memories).toHaveLength(2)
	})

	test("still saves when the embedder is unavailable, and says so", async () => {
		useBrokenEmbedder()
		const { config, worktree, call } = setup()

		const saved = await call("memory_save", { content: "Prefers tabs" })
		expect(saved).toContain("embedder unavailable")
		expect(loadStore(projectPath(config.dir, worktree), config).data.memories[0].embeddingModel).toBeNull()
	})

	test("rejects whitespace-only content", async () => {
		useEmbedder()
		const { call } = setup()
		expect(await call("memory_save", { content: "   " })).toContain("nothing saved")
	})
})

describe("memory_recall", () => {
	test("backfills vectors saved during an outage, then matches semantically", async () => {
		useBrokenEmbedder()
		const { config, worktree, call } = setup()
		await call("memory_save", { content: "The deploy pipeline runs on Buildkite" })

		useEmbedder()
		const found = await call("memory_recall", { query: "The deploy pipeline runs on Buildkite" })
		expect(found).toContain("Buildkite")

		const stored = loadStore(projectPath(config.dir, worktree), config).data.memories[0]
		expect(stored.embeddingModel).toBe(config.embeddingModel)
		expect(stored.embedding.length).toBeGreaterThan(0)
	})

	test("filters by type, tag and scope", async () => {
		useEmbedder()
		const { call } = setup()
		await call("memory_save", { content: "Prefers tabs", type: "preference", tags: ["style"], scope: "global" })
		await call("memory_save", { content: "Uses Bun as the runtime", type: "fact", tags: ["tooling"] })

		expect(await call("memory_recall", { query: "tabs bun", type: "preference" })).toContain("Prefers tabs")
		expect(await call("memory_recall", { query: "tabs bun", type: "preference" })).not.toContain("Bun as the")
		expect(await call("memory_recall", { query: "tabs bun", tag: "tooling" })).toContain("Bun as the")
		expect(await call("memory_recall", { query: "tabs bun", scope: "global" })).not.toContain("Bun as the")
	})

	test("reports a clean miss rather than unrelated results", async () => {
		useEmbedder()
		const { call } = setup()
		await call("memory_save", { content: "The deploy pipeline runs on Buildkite" })
		expect(await call("memory_recall", { query: "favourite pizza topping" })).toContain("No memories found")
	})

	test("warns when the store contains records it could not read", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()
		const file = projectPath(config.dir, worktree)
		writeStore(file, [memory({ id: "ok", content: "Uses Bun" })])
		const raw = JSON.parse(fs.readFileSync(file, "utf8"))
		raw.memories.push({ id: "broken" })
		fs.writeFileSync(file, JSON.stringify(raw))
		clearStoreCache()

		expect(await call("memory_recall", { query: "bun" })).toContain("failed validation")
	})
})

describe("memory_list", () => {
	test("groups by scope and reports an empty store", async () => {
		useEmbedder()
		const { call } = setup()
		expect(await call("memory_list", {})).toContain("No memories stored yet")

		await call("memory_save", { content: "Prefers tabs", scope: "global" })
		await call("memory_save", { content: "Uses Bun as the runtime", scope: "project" })

		const listed = await call("memory_list", {})
		expect(listed).toContain("Global memories (1)")
		expect(listed).toContain("Project memories (1)")
	})

	test("honours the limit", async () => {
		useEmbedder()
		const { call } = setup()
		for (const n of [1, 2, 3]) await call("memory_save", { content: `Fact number ${n} about the system` })
		const listed = await call("memory_list", { limit: 2 })
		expect(listed.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(2)
	})
})

describe("memory_update", () => {
	test("re-embeds changed content and replaces tags", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()
		const saved = await call("memory_save", { content: "Uses Buildkite", tags: ["ci"] })
		const id = saved.match(/memory (\S+):/)![1]
		const before = loadStore(projectPath(config.dir, worktree), config).data.memories[0].embedding

		await call("memory_update", { id, content: "Uses GitHub Actions", tags: ["pipeline"] })

		const after = loadStore(projectPath(config.dir, worktree), config).data.memories[0]
		expect(after.content).toBe("Uses GitHub Actions")
		expect(after.tags).toEqual(["pipeline"])
		expect(after.embedding).not.toEqual(before)
	})

	test("keeps the vector when only metadata changes", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()
		const saved = await call("memory_save", { content: "Uses Buildkite" })
		const id = saved.match(/memory (\S+):/)![1]
		const before = loadStore(projectPath(config.dir, worktree), config).data.memories[0].embedding

		await call("memory_update", { id, pinned: true })

		const after = loadStore(projectPath(config.dir, worktree), config).data.memories[0]
		expect(after.pinned).toBe(true)
		expect(after.embedding).toEqual(before)
	})

	test("reports an unknown id and rejects empty content", async () => {
		useEmbedder()
		const { call } = setup()
		expect(await call("memory_update", { id: "nope", content: "x" })).toContain("No memory with id")

		const saved = await call("memory_save", { content: "Uses Buildkite" })
		const id = saved.match(/memory (\S+):/)![1]
		expect(await call("memory_update", { id, content: "   " })).toContain("nothing updated")
	})
})

describe("memory_forget", () => {
	test("deletes by id and reports an unknown id", async () => {
		useEmbedder()
		const { config, worktree, call } = setup()
		const saved = await call("memory_save", { content: "Uses Buildkite" })
		const id = saved.match(/memory (\S+):/)![1]

		expect(await call("memory_forget", { id })).toContain("Forgot project memory")
		expect(loadStore(projectPath(config.dir, worktree), config).data.memories).toHaveLength(0)
		expect(await call("memory_forget", { id })).toContain("No memory with id")
	})
})
