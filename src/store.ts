import { createHash, randomBytes, randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import lockfile from "proper-lockfile"
import type { Config } from "./config.ts"
import { isMemoryType, type Memory, type StoreData } from "./types.ts"

export const globalPath = (dir: string) => path.join(dir, "memories.json")

export const projectIdPath = (worktree: string) => path.join(path.resolve(worktree), ".opencode", "memory-id")

export const legacyProjectPath = (dir: string, worktree: string) => {
	let identity = path.resolve(worktree)
	try {
		identity = fs.realpathSync.native(identity)
	} catch {
		// The resolved path is still a stable fallback for an unavailable worktree.
	}
	const key = createHash("sha256").update(identity).digest("hex")
	return path.join(dir, "projects", `${key}.json`)
}

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readProjectId(file: string): string | null {
	try {
		const id = fs.readFileSync(file, "utf8").trim()
		if (!PROJECT_ID_PATTERN.test(id)) throw new Error(`Invalid project memory id in ${file}`)
		return id.toLowerCase()
	} catch (error) {
		if (isNotFound(error)) return null
		throw error
	}
}

function ensureProjectId(worktree: string, create: boolean): string | null {
	const file = projectIdPath(worktree)
	const markerDir = path.dirname(file)
	try {
		const existing = readProjectId(file)
		if (existing) return existing
		if (!create) return null
		ensureDirectory(markerDir)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "EACCES" || code === "EROFS" || code === "ENOENT" || code === "ENOTDIR") return null
		throw error
	}

	const id = randomUUID()
	const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`
	let descriptor: number | null = null
	try {
		descriptor = fs.openSync(tmp, "wx", 0o600)
		fs.writeFileSync(descriptor, `${id}\n`)
		fs.fsyncSync(descriptor)
		fs.closeSync(descriptor)
		descriptor = null
		fs.linkSync(tmp, file)
		fsyncDirectory(markerDir)
		return id
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return readProjectId(file)
		const code = (error as NodeJS.ErrnoException).code
		if (
			code === "EACCES" ||
			code === "EROFS" ||
			code === "ENOENT" ||
			code === "ENOTDIR" ||
			code === "EPERM" ||
			code === "ENOTSUP" ||
			code === "EOPNOTSUPP" ||
			code === "EXDEV"
		)
			return null
		throw error
	} finally {
		if (descriptor !== null) fs.closeSync(descriptor)
		try {
			fs.unlinkSync(tmp)
		} catch (error) {
			if (!isNotFound(error)) throw error
		}
	}
}

function migrateLegacyProjectStore(config: Config, legacy: string, target: string): string {
	if (statOf(target) || !statOf(legacy)) return target
	let releaseLegacy: (() => void) | null = null
	let releaseTarget: (() => void) | null = null
	let tmp: string | null = null
	try {
		releaseLegacy = acquireStoreLock(legacy, config)
		if (statOf(target) || !statOf(legacy)) return target
		releaseTarget = acquireStoreLock(target, config)
		if (statOf(target) || !statOf(legacy)) return target

		const stat = statOf(legacy)
		if (!stat || stat.size > config.maxStoreBytes) return legacy
		const raw = fs.readFileSync(legacy)
		ensureDirectory(path.dirname(target))
		tmp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`
		const descriptor = fs.openSync(tmp, "wx", 0o600)
		try {
			fs.writeFileSync(descriptor, raw)
			fs.fsyncSync(descriptor)
		} finally {
			fs.closeSync(descriptor)
		}
		fs.renameSync(tmp, target)
		fsyncDirectory(path.dirname(target))
		fs.unlinkSync(legacy)
		fsyncDirectory(path.dirname(legacy))
		cache.delete(legacy)
		cache.delete(target)
		return target
	} catch (error) {
		// Once a marker exists, never fall back to a path that migration may
		// concurrently remove. A later access can safely retry the migration.
		if (statOf(target)) return target
		throw new Error(`Failed to migrate project memory store ${legacy}`, { cause: error })
	} finally {
		try {
			if (tmp) {
				try {
					fs.unlinkSync(tmp)
				} catch (error) {
					if (!isNotFound(error)) throw error
				}
			}
		} finally {
			releaseTarget?.()
			releaseLegacy?.()
		}
	}
}

export const projectPath = (config: Config, worktree: string, create = false) => {
	const legacy = legacyProjectPath(config.dir, worktree)
	const id = ensureProjectId(worktree, create || statOf(legacy) !== null)
	if (!id) return legacy
	return migrateLegacyProjectStore(config, legacy, path.join(config.dir, "projects", `${id}.json`))
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
	ensureDirectory(path.dirname(file))
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
		fsyncDirectory(path.dirname(file))
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

function fsyncDirectory(dirPath: string) {
	try {
		const descriptor = fs.openSync(dirPath, "r")
		try {
			fs.fsyncSync(descriptor)
		} finally {
			fs.closeSync(descriptor)
		}
	} catch {
		// Directory fsync is not portable and is only a durability nicety.
	}
}

function ensureDirectory(dirPath: string) {
	const missing: string[] = []
	let current = dirPath
	while (!statOf(current)) {
		missing.push(current)
		const parent = path.dirname(current)
		if (parent === current) break
		current = parent
	}
	fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 })
	for (const created of missing.reverse()) fsyncDirectory(path.dirname(created))
}

const sleepSync = (ms: number) => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function acquireStoreLock(file: string, config: Config): () => void {
	ensureDirectory(path.dirname(file))
	const lock = `${file}.lock`
	type LockOwner = { pid: number; token: string }
	const readOwner = (): LockOwner | null => {
		try {
			const value = JSON.parse(fs.readFileSync(lock, "utf8")) as Partial<LockOwner>
			return Number.isSafeInteger(value.pid) && (value.pid as number) > 0 && typeof value.token === "string"
				? (value as LockOwner)
				: null
		} catch {
			return null
		}
	}
	const processIsAlive = (pid: number) => {
		try {
			process.kill(pid, 0)
			return true
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "EPERM"
		}
	}

	for (let attempt = 0; ; attempt++) {
		try {
			const descriptor = fs.openSync(lock, "wx", 0o600)
			const owner = { pid: process.pid, token: randomBytes(16).toString("hex") }
			try {
				fs.writeFileSync(descriptor, JSON.stringify(owner))
				fs.fsyncSync(descriptor)
			} catch (error) {
				fs.closeSync(descriptor)
				try {
					fs.unlinkSync(lock)
				} catch {
					// Preserve the original lock initialization error.
				}
				throw error
			}
			const identity = fs.fstatSync(descriptor)
			return () => {
				fs.closeSync(descriptor)
				const currentOwner = readOwner()
				const current = statOf(lock)
				if (
					currentOwner?.token !== owner.token ||
					currentOwner.pid !== owner.pid ||
					!current ||
					current.dev !== identity.dev ||
					current.ino !== identity.ino
				)
					return
				try {
					fs.unlinkSync(lock)
				} catch (error) {
					if (!isNotFound(error)) throw error
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error

			const stat = statOf(lock)
			const owner = readOwner()
			if (stat && Date.now() - stat.mtimeMs > config.lockStaleMs && (!owner || !processIsAlive(owner.pid))) {
				const recovery = `${lock}.recovery`
				let releaseRecovery: (() => void) | null = null
				let removed = false
				try {
					releaseRecovery = lockfile.lockSync(recovery, {
						lockfilePath: recovery,
						realpath: false,
						stale: Math.max(5000, config.lockStaleMs),
						retries: 0,
					})
					const current = statOf(lock)
					const currentOwner = readOwner()
					if (
						current &&
						Date.now() - current.mtimeMs > config.lockStaleMs &&
						(!currentOwner || !processIsAlive(currentOwner.pid))
					) {
						fs.unlinkSync(lock)
						removed = true
					}
				} catch (recoveryError) {
					if ((recoveryError as NodeJS.ErrnoException).code !== "ELOCKED") throw recoveryError
				} finally {
					releaseRecovery?.()
				}
				if (removed) continue
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
