import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { clearPromptCache, coreBlock } from "../src/prompt.ts"
import { clearStoreCache, globalPath, projectPath } from "../src/store.ts"
import { cleanup, memory, tmpConfig, writeStore } from "./helpers.ts"

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

describe("core block", () => {
	test("is null until something is stored", () => {
		expect(coreBlock(freshConfig(), "/nowhere")).toBeNull()
	})

	test("separates pinned entries from the recent index", () => {
		const config = freshConfig()
		writeStore(globalPath(config.dir), [
			memory({ id: "p", content: "Always run bun run check", pinned: true }),
			memory({ id: "r", content: "The API lives in src/api" }),
		])
		const block = coreBlock(config, config.dir)!

		expect(block).toContain("### Pinned")
		expect(block).toContain("Always run bun run check")
		expect(block).toContain("### Recent memories")
		expect(block).toContain("The API lives in src/api")
		// Memory text is quoted so it cannot read as instructions.
		expect(block).toContain(JSON.stringify("Always run bun run check"))
	})

	test("omits entries that aged out of the index but keeps pinned ones", () => {
		const config = freshConfig({ indexMaxAgeDays: 30 })
		const old = Date.now() - 60 * 864e5
		writeStore(globalPath(config.dir), [
			memory({ id: "old", content: "stale note", updatedAt: old }),
			memory({ id: "oldpin", content: "pinned note", updatedAt: old, pinned: true }),
		])
		const block = coreBlock(config, config.dir)!

		expect(block).not.toContain("stale note")
		expect(block).toContain("pinned note")
	})

	test("keeps the tool instructions when every entry aged out of the index", () => {
		const config = freshConfig({ indexMaxAgeDays: 30 })
		const old = Date.now() - 60 * 864e5
		writeStore(globalPath(config.dir), [memory({ content: "stale note", updatedAt: old })])
		const block = coreBlock(config, config.dir)

		// The memory is still recallable, so the model must still be told it exists.
		expect(block).toContain("## Persistent memory")
		expect(block).toContain("memory_recall")
		expect(block).not.toContain("stale note")
	})

	test("is byte-stable across calls so prompt caching is not invalidated", () => {
		const config = freshConfig()
		writeStore(globalPath(config.dir), [memory()])
		expect(coreBlock(config, config.dir)).toBe(coreBlock(config, config.dir)!)
	})

	test("does not serve one project's block to another", () => {
		const config = freshConfig()
		const first = path.join(config.dir, "first")
		const second = path.join(config.dir, "second")
		fs.mkdirSync(first)
		fs.mkdirSync(second)
		writeStore(projectPath(config.dir, first), [memory({ id: "a", content: "first project" })])
		writeStore(projectPath(config.dir, second), [memory({ id: "b", content: "second project" })])

		expect(coreBlock(config, first)).toContain("first project")
		expect(coreBlock(config, second)).toContain("second project")
		expect(coreBlock(config, second)).not.toContain("first project")
		// And back again, to prove the cache is keyed and not a single slot.
		expect(coreBlock(config, first)).not.toContain("second project")
	})

	test("respects the configured index limits", () => {
		const config = freshConfig({ maxPinned: 1, maxIndexLines: 2 })
		writeStore(
			globalPath(config.dir),
			Array.from({ length: 5 }, (_, i) =>
				memory({ id: `m${i}`, content: `entry ${i}`, pinned: i < 3, updatedAt: Date.now() - i }),
			),
		)
		const block = coreBlock(config, config.dir)!
		const entries = block.split("\n").filter((l) => l.startsWith("- "))
		expect(entries).toHaveLength(3)
	})
})
