import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { resolveConfig } from "./config.ts"
import type { Logger, PluginContext } from "./context.ts"
import { warmEmbedder } from "./embedding.ts"
import { createHooks } from "./hooks.ts"
import { createTools } from "./tools/index.ts"

export const MemoryPlugin: Plugin = async ({ client, worktree }, options) => {
	const { config, warnings } = resolveConfig(options)

	const log: Logger = (level, message) => {
		try {
			void client?.app?.log({ body: { service: "memory", level, message } })
		} catch {
			// Logging is best effort and must never break a turn.
		}
	}

	for (const warning of warnings) log("warn", `config: ${warning}`)

	// Warm the model in the background. Hooks never wait for it: until it is
	// resident, retrieval falls back to keyword matching.
	warmEmbedder(config)

	const ctx: PluginContext = { config, log, worktree }

	return {
		...createHooks(ctx),
		tool: createTools(ctx),
	}
}

/**
 * Modern plugin module shape. OpenCode reads only the default export here, so
 * named exports (including test helpers) are safe. The legacy loader, by
 * contrast, iterates every export and rejects anything that is not a function.
 */
export default {
	id: "opencode-memory",
	server: MemoryPlugin,
} satisfies PluginModule
