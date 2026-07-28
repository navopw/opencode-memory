import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-memory-test-"))
process.env.OPENCODE_MEMORY_DIR = memoryDir

const { MemoryPlugin } = await import("../src/index.ts")
const helpers: any = (MemoryPlugin as any).__test

const memory = (overrides: Record<string, unknown> = {}) => ({
	id: "memory-id",
	content: "Use pnpm for package management",
	type: "preference",
	tags: ["packages"],
	pinned: false,
	createdAt: Date.now(),
	updatedAt: Date.now(),
	embedding: [1, 0],
	embeddingModel: helpers.CONFIG.embeddingModel,
	...overrides,
})

beforeAll(() => fs.mkdirSync(memoryDir, { recursive: true }))
afterAll(() => fs.rmSync(memoryDir, { recursive: true, force: true }))

describe("store validation", () => {
	test("accepts legacy memories and marks their embedding model unknown", () => {
		const value = memory()
		delete value.embeddingModel
		const store = helpers.parseStore(JSON.stringify({ version: 1, memories: [value] }), "memory.json")
		expect(store.memories[0].embeddingModel).toBeNull()
	})

	test("rejects malformed and duplicate records", () => {
		expect(() => helpers.parseStore("{}", "memory.json")).toThrow("Unsupported memory store")
		expect(() =>
			helpers.parseStore(
				JSON.stringify({ version: 1, memories: [memory(), memory({ content: "duplicate" })] }),
				"memory.json",
			),
		).toThrow("Duplicate memory id")
	})
})

describe("retrieval", () => {
	test("uses exact tokens and simple stemming", () => {
		expect(helpers.keywordHits(memory(), ["packages", "management"])).toBe(2)
		expect(helpers.stem("editors")).toBe("editor")
	})

	test("does not compare vectors from another embedding model", () => {
		const current = helpers.score(memory(), [1, 0], [])
		const stale = helpers.score(memory({ embeddingModel: "another/model" }), [1, 0], [])
		expect(current).toBe(1)
		expect(stale).toBe(0)
	})

	test("normalizes only exact duplicate content", () => {
		expect(helpers.contentKey("  Use   pnpm\n")).toBe("use pnpm")
		expect(helpers.contentKey("Do not use pnpm")).not.toBe(helpers.contentKey("Use pnpm"))
	})
})

describe("project isolation", () => {
	test("stores project memory outside the worktree", () => {
		const worktree = path.join(memoryDir, "project")
		fs.mkdirSync(worktree)
		const store = helpers.projectPath(worktree)
		expect(store.startsWith(path.join(memoryDir, "projects"))).toBe(true)
		expect(path.dirname(path.dirname(store))).toBe(memoryDir)
	})

	test("does not reuse a cached prompt block for another project", () => {
		const first = path.join(memoryDir, "first")
		const second = path.join(memoryDir, "second")
		fs.mkdirSync(first)
		fs.mkdirSync(second)
		const firstStore = helpers.projectPath(first)
		const secondStore = helpers.projectPath(second)
		fs.mkdirSync(path.dirname(firstStore), { recursive: true })
		fs.writeFileSync(firstStore, JSON.stringify({ version: 1, memories: [memory({ content: "first project" })] }))
		fs.writeFileSync(
			secondStore,
			JSON.stringify({ version: 1, memories: [memory({ id: "second-id", content: "second project" })] }),
		)
		const timestamp = new Date(1_700_000_000_000)
		fs.utimesSync(firstStore, timestamp, timestamp)
		fs.utimesSync(secondStore, timestamp, timestamp)
		helpers.cache.clear()

		expect(helpers.coreBlock(first)).toContain("first project")
		expect(helpers.coreBlock(second)).toContain("second project")
		expect(helpers.coreBlock(second)).not.toContain("first project")
	})
})
