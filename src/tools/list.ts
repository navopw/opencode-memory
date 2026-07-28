import { tool } from "@opencode-ai/plugin"
import type { PluginContext } from "../context.ts"
import { collect, droppedRecords } from "../memories.ts"
import { droppedNote, formatMemory, scopeFilterSchema, typeSchema } from "./shared.ts"

export const listTool = ({ config }: PluginContext) =>
	tool({
		description: "List saved memories, most recently updated first.",
		args: {
			type: typeSchema.optional().describe("Filter by type"),
			tag: tool.schema.string().optional().describe("Filter by a single tag"),
			scope: scopeFilterSchema.optional().describe('Where to look, default "all"'),
			limit: tool.schema.number().int().min(1).max(100).optional().describe("Max results, default 50"),
		},
		async execute(args, ctx) {
			try {
				const scope = args.scope ?? "all"
				const items = collect(config, ctx.worktree, scope)
					.filter(({ m }) => (!args.type || m.type === args.type) && (!args.tag || m.tags.includes(args.tag)))
					.sort((a, b) => b.m.updatedAt - a.m.updatedAt)
					.slice(0, args.limit ?? 50)

				const warning = droppedNote(droppedRecords(config, ctx.worktree, scope))
				if (!items.length) return `No memories stored yet.${warning}`

				const sections: string[] = []
				for (const bucket of ["global", "project"] as const) {
					const rows = items.filter((x) => x.scope === bucket)
					if (!rows.length) continue
					const title = bucket === "global" ? "Global" : "Project"
					sections.push(
						`${title} memories (${rows.length}):\n${rows.map(({ m, scope: s }) => formatMemory(m, s, { updated: true })).join("\n")}`,
					)
				}
				return `${sections.join("\n\n")}${warning}`
			} catch (e) {
				return `Failed to list memories: ${e}`
			}
		},
	})
