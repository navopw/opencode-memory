import { tool } from "@opencode-ai/plugin"
import { embeddingSignature } from "../config.ts"
import type { PluginContext } from "../context.ts"
import { embed } from "../embedding.ts"
import { findMemory } from "../memories.ts"
import { roundVector, updateStore } from "../store.ts"
import { contentSchema, embedderNote, tagsSchema, typeSchema } from "./shared.ts"

export const updateTool = ({ config }: PluginContext) =>
	tool({
		description: "Update an existing memory by id. Re-embeds automatically if the content changes.",
		args: {
			id: tool.schema.string().describe("Memory id, from memory_save/recall/list"),
			content: contentSchema.optional().describe("New content"),
			type: typeSchema.optional(),
			tags: tagsSchema.optional().describe("Replaces all tags"),
			pinned: tool.schema.boolean().optional(),
		},
		async execute(args, ctx) {
			try {
				const found = findMemory(config, ctx.worktree, args.id)
				if (!found) return `No memory with id ${args.id}.`
				if (args.content !== undefined && !args.content.trim()) return "Content is empty, nothing updated."

				const changesContent = args.content !== undefined && args.content !== found.m.content
				const vector = changesContent ? await embed(config, args.content as string, false) : null

				const memory = updateStore(found.file, config, (data) => {
					const current = data.memories.find((m) => m.id === args.id)
					if (!current) return null
					if (args.content !== undefined) {
						current.content = args.content
						if (changesContent) {
							// Drop a stale vector rather than keep one describing the old text.
							current.embedding = vector ? roundVector(vector) : []
							current.embeddingModel = vector ? embeddingSignature(config) : null
						}
					}
					if (args.type !== undefined) current.type = args.type
					if (args.tags !== undefined) current.tags = args.tags
					if (args.pinned !== undefined) current.pinned = args.pinned
					current.updatedAt = Date.now()
					return current
				})

				if (!memory) return `No memory with id ${args.id}.`
				const note = changesContent ? embedderNote(vector !== null) : ""
				return `Updated ${found.scope} memory ${memory.id}${note}:\n${memory.content}`
			} catch (e) {
				return `Failed to update memory: ${e}`
			}
		},
	})
