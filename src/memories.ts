import { embeddingSignature, type Config } from "./config.ts"
import { embed } from "./embedding.ts"
import { globalPath, loadStore, projectPath, roundVector, updateStore } from "./store.ts"
import type { Memory, Scope, ScopedMemory, ScopeFilter } from "./types.ts"

export const oneLine = (s: string, max = 140) => {
	const flat = s.replace(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export const contentKey = (content: string) => content.replace(/\s+/g, " ").trim().toLowerCase()

export const label = (m: Memory, scope: Scope) => `[${m.type}${scope === "project" ? ", project" : ""}]`

export function scopedStores(config: Config, worktree: string, scope: ScopeFilter) {
	const out: { scope: Scope; file: string }[] = []
	if (scope !== "project") out.push({ scope: "global", file: globalPath(config.dir) })
	if (scope !== "global") out.push({ scope: "project", file: projectPath(config, worktree) })
	return out
}

export const storeFor = (config: Config, worktree: string, scope: Scope) =>
	scope === "global" ? globalPath(config.dir) : projectPath(config, worktree, true)

export function collect(config: Config, worktree: string, scope: ScopeFilter): ScopedMemory[] {
	return scopedStores(config, worktree, scope).flatMap(({ scope: s, file }) =>
		loadStore(file, config).data.memories.map((m) => ({ m, scope: s, file })),
	)
}

/** Validation problems found the last time each in-scope store was read. */
export function droppedRecords(config: Config, worktree: string, scope: ScopeFilter): string[] {
	return scopedStores(config, worktree, scope).flatMap(({ file }) => {
		try {
			return loadStore(file, config).dropped.map((reason) => `${file}: ${reason}`)
		} catch {
			return []
		}
	})
}

export function findMemory(config: Config, worktree: string, id: string) {
	for (const { scope, file } of scopedStores(config, worktree, "all")) {
		const m = loadStore(file, config).data.memories.find((x) => x.id === id)
		if (m) return { scope, file, m }
	}
	return null
}

// One backfill per store file at a time, so the hook cannot pile up passes.
const backfilling = new Set<string>()

/**
 * Gives vectors to memories that were saved while the embedder was unavailable,
 * or that were embedded with a model the user has since changed away from.
 * Best effort: failures leave the memory on the keyword path.
 */
export async function backfill(config: Config, worktree: string, scope: ScopeFilter): Promise<number> {
	let embedded = 0
	for (const { file } of scopedStores(config, worktree, scope)) {
		if (backfilling.has(file)) continue
		backfilling.add(file)
		try {
			const stale = loadStore(file, config)
				.data.memories.filter((m) => m.embedding.length === 0 || m.embeddingModel !== embeddingSignature(config))
				.slice(0, config.backfillBatch)
			if (!stale.length) continue

			const completed: { id: string; content: string; embedding: number[] }[] = []
			for (const m of stale) {
				const vector = await embed(config, m.content, false)
				if (vector) completed.push({ id: m.id, content: m.content, embedding: roundVector(vector) })
			}
			if (!completed.length) continue

			updateStore(file, config, (data) => {
				for (const item of completed) {
					// Match on content too: the memory may have been edited meanwhile.
					const memory = data.memories.find((m) => m.id === item.id && m.content === item.content)
					if (!memory) continue
					memory.embedding = item.embedding
					memory.embeddingModel = embeddingSignature(config)
					embedded++
				}
			})
		} finally {
			backfilling.delete(file)
		}
	}
	return embedded
}
