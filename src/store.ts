import { createHash, randomBytes, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Config } from "./config.ts"
import { isMemoryType, type Memory, type StoreData } from "./types.ts"

export const globalPath = (dir: string) => path.join(dir, "memories.json")

export const projectPath = (dir: string, worktree: string) => {
	let identity = path.resolve(worktree)
	try {
		identity = fs.realpathSync.native(identity)
	} catch {
		// The resolved path is still a stable fallback for an unavailable worktree.
	}
	const key = createHash("sha256").update(identity).digest("hex")
	return path.join(dir, "projects", `${key}.json`)
}

export const emptyStore = (): StoreData => ({ version: 1, memories: [] })

export const newId = () => randomUUID()

/** Embeddings rounded to 4 decimals: ~60% smaller files, negligible cosine error. */
export const roundVector = (v: number[]) => v.map((x) => Math.round(x * 1e4) / 1e4)

export type StoreEntry = {
	data: StoreData
	/** Records that failed validation and were skipped, one message each. */
	dropped: string[]
}

const cache = new Map<string, StoreEntry & { mtimeMs: number }>()

export const clearStoreCache = () => cache.clear()

const isNotFound = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT"

const statOf = (file: string): fs.Stats | null => {
	try {
		return fs.statSync(file)
	} catch (error) {
		if (isNotFound(error)) return null
		throw error
	}
}

export const mtimeOf = (file: string) => statOf(file)?.mtimeMs ?? 0

function validate(value: unknown, index: number): Memory | string {
	if (!value || typeof value !== "object") return `record ${index} is not an object`
	const m = value as Partial<Memory>
	if (typeof m.id !== "string" || !m.id) return `record ${index} has no id`
	if (typeof m.content !== "string" || !m.content) return `record ${index} (${m.id}) has no content`
	if (!isMemoryType(m.type)) return `record ${index} (${m.id}) has an unknown type`
	if (!Array.isArray(m.tags) || !m.tags.every((tag) => typeof tag === "string"))
		return `record ${index} (${m.id}) has invalid tags`
	if (typeof m.pinned !== "boolean") return `record ${index} (${m.id}) has an invalid pinned flag`
	if (typeof m.createdAt !== "number" || !Number.isFinite(m.createdAt))
		return `record ${index} (${m.id}) has an invalid createdAt`
	if (typeof m.updatedAt !== "number" || !Number.isFinite(m.updatedAt))
		return `record ${index} (${m.id}) has an invalid updatedAt`
	if (!Array.isArray(m.embedding) || !m.embedding.every((n) => typeof n === "number" && Number.isFinite(n)))
		return `record ${index} (${m.id}) has an invalid embedding`
	if (m.embeddingModel !== undefined && m.embeddingModel !== null && typeof m.embeddingModel !== "string")
		return `record ${index} (${m.id}) has an invalid embeddingModel`

	return {
		id: m.id,
		content: m.content,
		type: m.type,
		tags: m.tags,
		pinned: m.pinned,
		createdAt: m.createdAt,
		updatedAt: m.updatedAt,
		embedding: m.embedding,
		embeddingModel: m.embeddingModel ?? null,
	}
}

/**
 * Whole-file problems (bad JSON, wrong version) throw, because writing over them
 * would destroy data we cannot interpret. Individual bad records are skipped and
 * reported instead, so one damaged entry cannot disable the entire plugin.
 */
export function parseStore(raw: string, file: string): StoreEntry {
	const parsed: unknown = JSON.parse(raw)
	if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
		throw new Error(`Unsupported memory store in ${file}`)
	}
	const memories = (parsed as { memories?: unknown }).memories
	if (!Array.isArray(memories)) throw new Error(`Invalid memory store in ${file}`)

	const dropped: string[] = []
	const ids = new Set<string>()
	const valid: Memory[] = []
	memories.forEach((value, index) => {
		const result = validate(value, index)
		if (typeof result === "string") {
			dropped.push(result)
			return
		}
		if (ids.has(result.id)) {
			dropped.push(`record ${index} duplicates id ${result.id}`)
			return
		}
		ids.add(result.id)
		valid.push(result)
	})

	return { data: { version: 1, memories: valid }, dropped }
}

export function loadStore(file: string, config: Config): StoreEntry {
	const mtimeMs = mtimeOf(file)
	const hit = cache.get(file)
	if (hit && hit.mtimeMs === mtimeMs) return hit
	const stat = statOf(file)
	if (stat && stat.size > config.maxStoreBytes) {
		throw new Error(`Memory store exceeds ${Math.round(config.maxStoreBytes / 1024 / 1024)} MiB: ${file}`)
	}
	const entry: StoreEntry = stat
		? parseStore(fs.readFileSync(file, "utf8"), file)
		: { data: emptyStore(), dropped: [] }
	cache.set(file, { ...entry, mtimeMs })
	return entry
}

export const loadMemories = (file: string, config: Config): Memory[] => loadStore(file, config).data.memories

/** Keep a copy of a file we could only partially read, before overwriting it. */
function quarantine(file: string) {
	const backup = `${file}.corrupt`
	try {
		if (statOf(backup)) return
		fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error
	}
}

function persist(file: string, data: StoreData) {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
	const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`
	try {
		// fsync the contents before the rename: the rename is atomic for readers,
		// but without the flush a crash can still leave a truncated file behind.
		const fd = fs.openSync(tmp, "wx", 0o600)
		try {
			fs.writeFileSync(fd, JSON.stringify(data, null, "\t"))
			fs.fsyncSync(fd)
		} finally {
			fs.closeSync(fd)
		}
		fs.renameSync(tmp, file)
		try {
			const dir = fs.openSync(path.dirname(file), "r")
			try {
				fs.fsyncSync(dir)
			} finally {
				fs.closeSync(dir)
			}
		} catch {
			// Directory fsync is not portable and is only a durability nicety.
		}
		cache.set(file, { data, dropped: [], mtimeMs: mtimeOf(file) })
	} catch (error) {
		try {
			fs.unlinkSync(tmp)
		} catch (cleanupError) {
			if (!isNotFound(cleanupError)) throw cleanupError
		}
		throw error
	}
}

const sleepSync = (ms: number) => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function acquireStoreLock(file: string, config: Config): () => void {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
	const lock = `${file}.lock`

	for (let attempt = 0; ; attempt++) {
		try {
			const descriptor = fs.openSync(lock, "wx", 0o600)
			return () => {
				fs.closeSync(descriptor)
				try {
					fs.unlinkSync(lock)
				} catch (error) {
					if (!isNotFound(error)) throw error
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error

			const stat = statOf(lock)
			if (stat && Date.now() - stat.mtimeMs > config.lockStaleMs) {
				// Re-stat and compare inode before unlinking, so we cannot delete a
				// fresh lock that another process created since the check above.
				const current = statOf(lock)
				if (current && current.ino === stat.ino && current.mtimeMs === stat.mtimeMs) {
					try {
						fs.unlinkSync(lock)
					} catch (unlinkError) {
						if (!isNotFound(unlinkError)) throw unlinkError
					}
				}
				continue
			}

			if (attempt >= config.lockRetries) throw new Error(`Memory store is busy: ${file}`)
			sleepSync(config.lockRetryMs * (attempt + 1))
		}
	}
}

export function updateStore<T>(file: string, config: Config, update: (data: StoreData) => T): T {
	const release = acquireStoreLock(file, config)
	try {
		cache.delete(file)
		const entry = loadStore(file, config)
		if (entry.dropped.length) quarantine(file)
		const data = structuredClone(entry.data)
		const result = update(data)
		persist(file, data)
		return result
	} finally {
		release()
	}
}
