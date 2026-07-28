export type MemoryType = "preference" | "fact" | "decision" | "todo"

export const MEMORY_TYPES = ["preference", "fact", "decision", "todo"] as const

export type Memory = {
	id: string
	content: string
	type: MemoryType
	tags: string[]
	pinned: boolean
	createdAt: number
	updatedAt: number
	embedding: number[]
	embeddingModel: string | null
}

export type StoreData = { version: 1; memories: Memory[] }

export type Scope = "global" | "project"

export type ScopeFilter = "all" | Scope

/** A memory plus where it came from, the shape retrieval and the tools work with. */
export type ScopedMemory = { m: Memory; scope: Scope; file: string }

export const isMemoryType = (value: unknown): value is MemoryType =>
	value === "preference" || value === "fact" || value === "decision" || value === "todo"
