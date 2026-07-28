import { tool } from "@opencode-ai/plugin"
import { oneLine } from "../memories.ts"
import { MEMORY_TYPES, type Memory, type Scope } from "../types.ts"

export const typeSchema = tool.schema.enum(MEMORY_TYPES)
export const scopeFilterSchema = tool.schema.enum(["all", "global", "project"])
export const scopeSchema = tool.schema.enum(["global", "project"])
export const contentSchema = tool.schema.string().min(1).max(8000)
export const tagsSchema = tool.schema.array(tool.schema.string().min(1).max(50)).max(50)

/** One line per memory, stable across tools so ids are easy to copy back. */
export function formatMemory(
	m: Memory,
	scope: Scope,
	extra?: { score?: number; updated?: boolean; max?: number },
): string {
	const head = `- [${m.id}][${scope}][${m.type}]${m.pinned ? "[pinned]" : ""} ${oneLine(m.content, extra?.max ?? 200)}`
	const meta: string[] = []
	if (extra?.score !== undefined) meta.push(`score ${extra.score.toFixed(2)}`)
	if (extra?.updated) meta.push(`updated ${new Date(m.updatedAt).toISOString().slice(0, 10)}`)
	if (m.tags.length) meta.push(`tags: ${m.tags.join(", ")}`)
	return meta.length ? `${head}  (${meta.join(", ")})` : head
}

export const embedderNote = (embedded: boolean) =>
	embedded ? "" : " (embedder unavailable, keyword search only)"

/** Surface records that failed validation so silent data loss is visible. */
export const droppedNote = (dropped: string[]) =>
	dropped.length
		? `\n\nWarning: ${dropped.length} stored record(s) failed validation and were skipped. A copy of the original file was kept alongside it with a .corrupt suffix.\n${dropped
				.slice(0, 5)
				.map((d) => `  - ${d}`)
				.join("\n")}`
		: ""
