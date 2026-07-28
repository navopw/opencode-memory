import type { Config } from "./config.ts"

export type Logger = (level: "info" | "warn" | "error", message: string) => void

export type PluginContext = {
	config: Config
	log: Logger
	/** Worktree the plugin was created for. Tool calls carry their own. */
	worktree: string
}
