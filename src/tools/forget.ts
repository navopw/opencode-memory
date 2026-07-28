import { tool } from "@opencode-ai/plugin"
import type { PluginContext } from "../context.ts"
import { findMemory, oneLine } from "../memories.ts"
import { updateStore } from "../store.ts"

export const forgetTool = ({ config }: PluginContext) =>
	tool({
		description: "Delete a memory by id.",
		args: {
			id: tool.schema.string().describe("Memory id, from memory_save/recall/list"),
		},
		async execute(args, ctx) {
			try {
				const found = findMemory(config, ctx.worktree, args.id)
				if (!found) return `No memory with id ${args.id}.`
				const forgotten = updateStore(found.file, config, (data) => {
					const current = data.memories.find((m) => m.id === args.id)
					if (!current) return null
					data.memories = data.memories.filter((m) => m.id !== args.id)
					return current
				})
				if (!forgotten) return `No memory with id ${args.id}.`
				return `Forgot ${found.scope} memory ${forgotten.id}: ${oneLine(forgotten.content, 100)}`
			} catch (e) {
				return `Failed to forget memory: ${e}`
			}
		},
	})
