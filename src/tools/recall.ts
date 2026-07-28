import { tool } from "@opencode-ai/plugin"
import type { PluginContext } from "../context.ts"
import { embed } from "../embedding.ts"
import { backfill, collect, droppedRecords } from "../memories.ts"
import { diversify, isRelevant, keywordHits, score, tokenize } from "../scoring.ts"
import { droppedNote, embedderNote, formatMemory, scopeFilterSchema, typeSchema } from "./shared.ts"

export const recallTool = ({ config }: PluginContext) =>
	tool({
		description:
			"Semantic search over saved memories. Use when you are unsure about a user preference, project convention, or past decision instead of guessing.",
		args: {
			query: tool.schema.string().min(1).describe("What to look for, in natural language"),
			limit: tool.schema.number().int().min(1).max(100).optional().describe("Max results, default 5"),
			type: typeSchema.optional().describe("Filter by type"),
			tag: tool.schema.string().optional().describe("Filter by a single tag"),
			scope: scopeFilterSchema.optional().describe('Where to search, default "all"'),
		},
		async execute(args, ctx) {
			try {
				const scope = args.scope ?? "all"
				const queryEmbedding = await embed(config, args.query, true)
				// Give embedding-less memories a vector now that we have a model.
				if (queryEmbedding) await backfill(config, ctx.worktree, scope)

				const queryTokens = tokenize(args.query, true)
				const scored = collect(config, ctx.worktree, scope)
					.filter(({ m }) => (!args.type || m.type === args.type) && (!args.tag || m.tags.includes(args.tag)))
					.map((x) => ({ ...x, s: score(config, x.m, queryEmbedding, queryTokens) }))
					// A lower bar than injection: the model asked for this explicitly.
					.filter((x) =>
						queryEmbedding
							? x.s > 0.2 || isRelevant(config, x.m, x.s, queryEmbedding, queryTokens)
							: keywordHits(x.m, queryTokens) > 0,
					)
					.sort((a, b) => b.s - a.s)

				const hits = diversify(config, scored, args.limit ?? 5)
				const warning = droppedNote(droppedRecords(config, ctx.worktree, scope))
				if (!hits.length) {
					return `No memories found for "${args.query}"${embedderNote(queryEmbedding !== null)}.${warning}`
				}
				const lines = hits.map(({ m, scope: s, s: sc }) => formatMemory(m, s, { score: sc, max: 400 }))
				return `${hits.length} memor${hits.length === 1 ? "y" : "ies"} found:\n${lines.join("\n")}${warning}`
			} catch (e) {
				return `Failed to recall memories: ${e}`
			}
		},
	})
