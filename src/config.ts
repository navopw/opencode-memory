import * as os from "node:os"
import * as path from "node:path"

export type Config = {
	/** Storage root for the global store and the per-project stores. */
	dir: string
	/** Embedding model, runs locally on CPU via transformers.js (ONNX). */
	embeddingModel: string
	/** bge models retrieve better when queries carry this instruction prefix. */
	queryPrefix: string
	/** Max memories injected per user message. */
	topK: number
	/** Minimum score for a memory to be injected into a turn. */
	injectThreshold: number
	/**
	 * Keyword hits required to inject a memory that has no comparable vector.
	 * Capped by the query's token count so short queries can still match.
	 */
	keywordMinHits: number
	/** Hits this similar to an already-selected hit are skipped (diversification). */
	nearDupeThreshold: number
	/** memory_save refuses to create a second memory this similar to an existing one. */
	duplicateThreshold: number
	/** System prompt core block limits. */
	maxPinned: number
	maxIndexLines: number
	/** Only memories updated within this window appear in the prompt index. */
	indexMaxAgeDays: number
	/** Timeouts: hooks must stay fast, tools may take longer. */
	hookTimeoutMs: number
	toolTimeoutMs: number
	/** After a failed embedder load, wait this long before retrying. */
	embedderRetryMs: number
	/** Do not re-inject a memory into a session within this many turns. */
	reinjectAfterTurns: number
	/** Max memories to backfill embeddings for in a single pass. */
	backfillBatch: number
	/** Refuse unexpectedly large stores instead of blocking the OpenCode process. */
	maxStoreBytes: number
	/** A lock file older than this is treated as abandoned. */
	lockStaleMs: number
	/** Retries and delay when another process holds the store lock. */
	lockRetries: number
	lockRetryMs: number
}

const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

export const DEFAULTS: Config = {
	dir: path.join(os.homedir(), ".config", "opencode", "memory"),
	embeddingModel: "Xenova/bge-small-en-v1.5",
	queryPrefix: BGE_QUERY_PREFIX,
	topK: 5,
	injectThreshold: 0.55,
	keywordMinHits: 2,
	nearDupeThreshold: 0.95,
	duplicateThreshold: 0.92,
	maxPinned: 10,
	maxIndexLines: 30,
	indexMaxAgeDays: 90,
	hookTimeoutMs: 3000,
	toolTimeoutMs: 15000,
	embedderRetryMs: 5 * 60 * 1000,
	reinjectAfterTurns: 8,
	backfillBatch: 10,
	maxStoreBytes: 10 * 1024 * 1024,
	lockStaleMs: 30_000,
	lockRetries: 5,
	lockRetryMs: 40,
}

/** Inclusive bounds for every numeric option, so a bad config cannot wedge the plugin. */
const BOUNDS: Record<string, [number, number]> = {
	topK: [1, 50],
	injectThreshold: [0, 2],
	keywordMinHits: [1, 10],
	nearDupeThreshold: [0, 1],
	duplicateThreshold: [0, 1],
	maxPinned: [0, 100],
	maxIndexLines: [0, 200],
	indexMaxAgeDays: [1, 36500],
	hookTimeoutMs: [100, 60_000],
	toolTimeoutMs: [100, 600_000],
	embedderRetryMs: [0, 86_400_000],
	reinjectAfterTurns: [0, 1000],
	backfillBatch: [0, 500],
	maxStoreBytes: [1024, 1024 * 1024 * 1024],
	lockStaleMs: [1000, 600_000],
	lockRetries: [0, 100],
	lockRetryMs: [1, 5000],
}

const STRING_KEYS = ["dir", "embeddingModel", "queryPrefix"] as const

export const REMEMBER_PATTERN = /\b(remember|don'?t forget|do not forget|note to self|keep in mind)\b/i

// Common English function words, excluded from query keywords so they cannot
// inflate the keyword boost.
export const STOPWORDS = new Set(
	"the and or but if then else when where why how what which who whom this that these those am is are was were be been being have has had having do does did doing will would shall should can could may might must of at by for with about into through during before after to from up down in out on off over under again once here there all any both each few more most other some such no nor not only own same so than too very just you your he him his she her it its they them their we us our me my as an".split(
		" ",
	),
)

export type ResolvedConfig = { config: Config; warnings: string[] }

/**
 * Precedence: opencode.jsonc plugin options > environment > defaults.
 *
 * Invalid values are reported and ignored rather than thrown, because a typo in
 * a config file should not stop OpenCode from starting.
 */
export function resolveConfig(
	options: Record<string, unknown> | undefined,
	env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
	const config: Config = { ...DEFAULTS }
	const warnings: string[] = []

	if (env.OPENCODE_MEMORY_DIR) config.dir = env.OPENCODE_MEMORY_DIR
	if (env.OPENCODE_MEMORY_MODEL) config.embeddingModel = env.OPENCODE_MEMORY_MODEL

	let queryPrefixSetByUser = false

	for (const [key, value] of Object.entries(options ?? {})) {
		if (value === undefined || value === null) continue

		if ((STRING_KEYS as readonly string[]).includes(key)) {
			if (typeof value !== "string") {
				warnings.push(`option "${key}" must be a string, ignoring ${JSON.stringify(value)}`)
				continue
			}
			if (key === "queryPrefix") queryPrefixSetByUser = true
			;(config as unknown as Record<string, string>)[key] = value
			continue
		}

		const bounds = BOUNDS[key]
		if (!bounds) {
			warnings.push(`unknown option "${key}", ignoring`)
			continue
		}
		if (typeof value !== "number" || !Number.isFinite(value)) {
			warnings.push(`option "${key}" must be a finite number, ignoring ${JSON.stringify(value)}`)
			continue
		}
		const [min, max] = bounds
		if (value < min || value > max) {
			warnings.push(`option "${key}" must be between ${min} and ${max}, clamping ${value}`)
		}
		;(config as unknown as Record<string, number>)[key] = Math.min(max, Math.max(min, value))
	}

	// The bge instruction prefix hurts models that were not trained with it, so
	// drop it automatically when the model changed and the user did not opt in.
	if (!queryPrefixSetByUser && !env.OPENCODE_MEMORY_QUERY_PREFIX && !/bge/i.test(config.embeddingModel)) {
		config.queryPrefix = ""
	}
	if (env.OPENCODE_MEMORY_QUERY_PREFIX !== undefined && !queryPrefixSetByUser) {
		config.queryPrefix = env.OPENCODE_MEMORY_QUERY_PREFIX
	}

	return { config, warnings }
}
