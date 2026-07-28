import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import {
	clearStoreCache,
	globalPath,
	legacyProjectPath,
	loadStore,
	parseStore,
	projectIdPath,
	projectPath,
	updateStore,
} from "../src/store.ts"
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
})

describe("parseStore", () => {
	test("throws on whole-file problems that must not be overwritten", () => {
		expect(() => parseStore("{}", "m.json")).toThrow("Unsupported memory store")
		expect(() => parseStore(JSON.stringify({ version: 1 }), "m.json")).toThrow("Invalid memory store")
		expect(() => parseStore("not json", "m.json")).toThrow()
	})

	test("keeps valid records and reports the ones it skipped", () => {
		const entry = parseStore(
			JSON.stringify({
				version: 1,
				memories: [
					memory({ id: "good" }),
					{ id: "bad", content: "no type" },
					memory({ id: "good-2", content: "second" }),
					null,
				],
			}),
			"m.json",
		)
		expect(entry.data.memories.map((m) => m.id)).toEqual(["good", "good-2"])
		expect(entry.dropped).toHaveLength(2)
	})

	test("drops duplicate ids rather than failing the whole store", () => {
		const entry = parseStore(
			JSON.stringify({ version: 1, memories: [memory(), memory({ content: "duplicate id" })] }),
			"m.json",
		)
		expect(entry.data.memories).toHaveLength(1)
		expect(entry.dropped.join()).toContain("duplicates id")
	})

	test("accepts legacy records with no embeddingModel", () => {
		const legacy: Record<string, unknown> = { ...memory() }
		delete legacy.embeddingModel
		const entry = parseStore(JSON.stringify({ version: 1, memories: [legacy] }), "m.json")
		expect(entry.data.memories[0].embeddingModel).toBeNull()
	})
})

describe("persistence", () => {
	test("writes atomically with owner-only permissions and no leftover temp files", () => {
		const config = freshConfig()
		const file = globalPath(config.dir)
		updateStore(file, config, (data) => data.memories.push(memory()))

		expect(loadStore(file, config).data.memories).toHaveLength(1)
		expect(fs.statSync(file).mode & 0o777).toBe(0o600)
		expect(fs.readdirSync(config.dir).filter((f) => f.includes(".tmp-"))).toEqual([])
	})

	test("re-reads a store that changed on disk underneath the cache", () => {
		const config = freshConfig()
		const file = globalPath(config.dir)
		writeStore(file, [memory({ content: "first" })])
		expect(loadStore(file, config).data.memories[0].content).toBe("first")

		writeStore(file, [memory({ content: "second" })])
		expect(loadStore(file, config).data.memories[0].content).toBe("second")
	})

	test("refuses to read a store larger than the configured limit", () => {
		const config = freshConfig({ maxStoreBytes: 64 })
		const file = globalPath(config.dir)
		writeStore(file, Array.from({ length: 20 }, (_, i) => memory({ id: `m${i}` })))
		expect(() => loadStore(file, config)).toThrow("exceeds")
	})

	test("keeps a copy of a partially invalid store before rewriting it", () => {
		const config = freshConfig()
		const file = globalPath(config.dir)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(
			file,
			JSON.stringify({ version: 1, memories: [memory({ id: "keep" }), { id: "broken" }] }),
		)
		clearStoreCache()

		updateStore(file, config, (data) => data.memories.push(memory({ id: "added", content: "new" })))

		const backup = JSON.parse(fs.readFileSync(`${file}.corrupt`, "utf8"))
		expect(backup.memories).toHaveLength(2)
		expect(loadStore(file, config).data.memories.map((m) => m.id)).toEqual(["keep", "added"])
	})
})

describe("locking", () => {
	test("gives up with a clear error while another process holds the lock", () => {
		const config = freshConfig()
		const file = globalPath(config.dir)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(`${file}.lock`, "")

		expect(() => updateStore(file, config, () => {})).toThrow("busy")
		fs.unlinkSync(`${file}.lock`)
	})

	test("breaks a lock left behind by a dead process", () => {
		const config = freshConfig({ lockStaleMs: 1000 })
		const file = globalPath(config.dir)
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(`${file}.lock`, "")
		const old = new Date(Date.now() - 60_000)
		fs.utimesSync(`${file}.lock`, old, old)

		updateStore(file, config, (data) => data.memories.push(memory()))
		expect(loadStore(file, config).data.memories).toHaveLength(1)
		expect(fs.existsSync(`${file}.lock`)).toBe(false)
	})

	test("does not break a stale lock owned by a live process", () => {
		const config = freshConfig({ lockStaleMs: 1000 })
		const file = globalPath(config.dir)
		const lock = `${file}.lock`
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "live-owner" }))
		const old = new Date(Date.now() - 60_000)
		fs.utimesSync(lock, old, old)

		expect(() => updateStore(file, config, () => {})).toThrow("busy")
		expect(fs.existsSync(lock)).toBe(true)
		fs.unlinkSync(lock)
	})

	test("allows only one process to recover a stale lock", () => {
		const config = freshConfig({ lockStaleMs: 1000 })
		const file = globalPath(config.dir)
		const lock = `${file}.lock`
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(lock, "")
		fs.mkdirSync(`${lock}.recovery`)
		const old = new Date(Date.now() - 60_000)
		fs.utimesSync(lock, old, old)

		expect(() => updateStore(file, config, () => {})).toThrow("busy")
		expect(fs.existsSync(lock)).toBe(true)
		fs.rmdirSync(`${lock}.recovery`)
		fs.unlinkSync(lock)
	})

	test("recovers an abandoned stale-lock guard", () => {
		const config = freshConfig({ lockStaleMs: 1000 })
		const file = globalPath(config.dir)
		const lock = `${file}.lock`
		const recovery = `${lock}.recovery`
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(lock, "")
		fs.mkdirSync(recovery)
		const old = new Date(Date.now() - 60_000)
		fs.utimesSync(lock, old, old)
		fs.utimesSync(recovery, old, old)

		updateStore(file, config, (data) => data.memories.push(memory()))
		expect(loadStore(file, config).data.memories).toHaveLength(1)
		expect(fs.existsSync(recovery)).toBe(false)
	})

	test("does not remove a replacement lock when releasing", () => {
		const config = freshConfig()
		const file = globalPath(config.dir)
		const lock = `${file}.lock`

		updateStore(file, config, () => {
			fs.unlinkSync(lock)
			fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: "replacement" }))
		})

		expect(fs.existsSync(lock)).toBe(true)
		fs.unlinkSync(lock)
	})

	test("releases the lock when the update callback throws", () => {
		const config = freshConfig()
		const file = globalPath(config.dir)
		expect(() =>
			updateStore(file, config, () => {
				throw new Error("boom")
			}),
		).toThrow("boom")
		expect(fs.existsSync(`${file}.lock`)).toBe(false)
		updateStore(file, config, (data) => data.memories.push(memory()))
		expect(loadStore(file, config).data.memories).toHaveLength(1)
	})
})

describe("project isolation", () => {
	test("stores project memories outside the worktree, keyed by a local marker", () => {
		const config = freshConfig()
		const worktree = path.join(config.dir, "project")
		fs.mkdirSync(worktree)
		const store = projectPath(config, worktree, true)
		const id = fs.readFileSync(projectIdPath(worktree), "utf8").trim()
		expect(store.startsWith(path.join(config.dir, "projects"))).toBe(true)
		expect(path.dirname(path.dirname(store))).toBe(config.dir)
		expect(path.basename(store)).toBe(`${id}.json`)
		expect(fs.statSync(projectIdPath(worktree)).mode & 0o777).toBe(0o600)
		expect(fs.readdirSync(path.dirname(projectIdPath(worktree))).filter((f) => f.includes(".tmp-"))).toEqual([])
	})

	test("gives two worktrees two different stores", () => {
		const config = freshConfig()
		const a = path.join(config.dir, "a")
		const b = path.join(config.dir, "b")
		fs.mkdirSync(a)
		fs.mkdirSync(b)
		expect(projectPath(config, a, true)).not.toBe(projectPath(config, b, true))
	})

	test("does not add a marker when an empty project is only read", () => {
		const config = freshConfig()
		const worktree = path.join(config.dir, "project")
		fs.mkdirSync(worktree)

		projectPath(config, worktree)
		expect(fs.existsSync(projectIdPath(worktree))).toBe(false)
	})

	test("keeps the same store when a non-git worktree moves", () => {
		const config = freshConfig()
		const original = path.join(config.dir, "project-a")
		const moved = path.join(config.dir, "archive", "project-a")
		fs.mkdirSync(original)
		const before = projectPath(config, original, true)
		fs.mkdirSync(path.dirname(moved))
		fs.renameSync(original, moved)

		expect(projectPath(config, moved)).toBe(before)
	})

	test("migrates the canonical-path store on first access", () => {
		const config = freshConfig()
		const worktree = path.join(config.dir, "project")
		fs.mkdirSync(worktree)
		const legacy = legacyProjectPath(config.dir, worktree)
		writeStore(legacy, [memory({ content: "legacy project memory" })])

		const current = projectPath(config, worktree)
		expect(current).not.toBe(legacy)
		expect(fs.existsSync(legacy)).toBe(false)
		expect(fs.statSync(current).mode & 0o777).toBe(0o600)
		expect(loadStore(current, config).data.memories[0].content).toBe("legacy project memory")
	})

	test("fails safely instead of writing through a contended legacy migration", () => {
		const config = freshConfig()
		const worktree = path.join(config.dir, "project")
		fs.mkdirSync(worktree)
		const legacy = legacyProjectPath(config.dir, worktree)
		writeStore(legacy, [memory({ content: "legacy project memory" })])
		fs.writeFileSync(`${legacy}.lock`, JSON.stringify({ pid: process.pid, token: "old-writer" }))

		expect(() => projectPath(config, worktree)).toThrow("Failed to migrate")
		expect(fs.existsSync(legacy)).toBe(true)
		fs.unlinkSync(`${legacy}.lock`)
		expect(projectPath(config, worktree)).not.toBe(legacy)
	})

	test("rejects an invalid project marker", () => {
		const config = freshConfig()
		const worktree = path.join(config.dir, "project")
		fs.mkdirSync(path.dirname(projectIdPath(worktree)), { recursive: true })
		fs.writeFileSync(projectIdPath(worktree), "../../other-project")

		expect(() => projectPath(config, worktree)).toThrow("Invalid project memory id")
	})
})
