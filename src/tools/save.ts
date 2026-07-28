import { tool } from "@opencode-ai/plugin"
import { embeddingSignature } from "../config.ts"
import type { PluginContext } from "../context.ts"
import { embed } from "../embedding.ts"
import { contentKey, storeFor } from "../memories.ts"
import { cosine, isComparable } from "../scoring.ts"
import { loadStore, newId, roundVector, updateStore } from "../store.ts"
import type { Memory, Scope } from "../types.ts"
import { contentSchema, embedderNote, formatMemory, scopeSchema, tagsSchema, typeSchema } from "./shared.ts"

export const saveTool = ({ config }: PluginContext) =>
	tool({
		description:
			'Save a durable memory for future sessions: a user preference, project fact, architecture decision, or todo. Use scope "global" for user-level preferences across projects, "project" (default) for facts about this codebase. Do not save transient task details or anything derivable from reading the code.',
		args: {
			content: contentSchema.describe("The memory, one clear statement"),
			type: typeSchema.optional().describe('Memory type, default "fact"'),
			tags: tagsSchema.optional().describe("Short lowercase tags for filtering"),
			pinned: tool.schema
				.boolean()
				.optional()
				.describe("Pin into the system prompt every session. Use sparingly, only for standing instructions."),
			scope: scopeSchema.optional().describe('"project" (default) or "global"'),
			force: tool.schema
				.boolean()
				.optional()
				.describe("Save even if a very similar memory already exists. Prefer memory_update instead."),
		},
		async execute(args, ctx) {
			try {
				if (!args.content.trim()) return "Content is empty, nothing saved."
				const scope: Scope = args.scope === "global" ? "global" : "project"
				const file = storeFor(config, ctx.worktree, scope)
				const vector = await embed(config, args.content, false)
				const embedding = vector ? roundVector(vector) : []

				// Block accidental near-duplicates before writing: this is the main
				// way the store degrades, since exact-text matching cannot catch
				// "prefers pnpm" against "uses pnpm for packages".
				if (embedding.length && !args.force) {
					const existing = loadStore(file, config).data.memories
					let best: { m: Memory; s: number } | null = null
					for (const m of existing) {
						if (contentKey(m.content) === contentKey(args.content)) {
							best = null
							break
						}
						if (!isComparable(m, config)) continue
						const s = cosine(embedding, m.embedding)
						if (s >= config.duplicateThreshold && (!best || s > best.s)) best = { m, s }
					}
					if (best) {
						return (
							`Not saved: a very similar ${scope} memory already exists (similarity ${best.s.toFixed(2)}).\n` +
							`${formatMemory(best.m, scope)}\n\n` +
							"Use memory_update with that id to revise it, or call memory_save again with force=true if this is genuinely distinct."
						)
					}
				}

				const result = updateStore(file, config, (data) => {
					const existing = data.memories.find((m) => contentKey(m.content) === contentKey(args.content))
					if (existing) {
						existing.type = args.type ?? existing.type
						existing.tags = [...new Set([...existing.tags, ...(args.tags ?? [])])]
						existing.pinned = args.pinned ?? existing.pinned
						existing.updatedAt = Date.now()
						if (embedding.length) {
							existing.embedding = embedding
							existing.embeddingModel = embeddingSignature(config)
						}
						return { memory: existing, updated: true }
					}
					const memory: Memory = {
						id: newId(),
						content: args.content,
						type: args.type ?? "fact",
						tags: args.tags ?? [],
						pinned: args.pinned ?? false,
						createdAt: Date.now(),
						updatedAt: Date.now(),
						embedding,
						embeddingModel: embedding.length ? embeddingSignature(config) : null,
					}
					data.memories.push(memory)
					return { memory, updated: false }
				})

				return `${result.updated ? "Updated existing" : "Saved"} ${scope} memory ${result.memory.id}${embedderNote(embedding.length > 0)}:\n${result.memory.content}`
			} catch (e) {
				return `Failed to save memory: ${e}`
			}
		},
	})
