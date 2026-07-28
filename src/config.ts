import * as os from "node:os"
import * as path from "node:path"

export type Config = {
	/** Storage root for the global store and the per-project stores. */
	dir: string
	/** Embedding model, runs locally on CPU via transformers.js (ONNX). */
	embeddingModel: string
	/**
	 * Sentence pooling. Must match how the model was trained: bge uses the CLS
	 * token, e5 and the MiniLM family average the token vectors. Getting this
	 * wrong produces embeddings that still look valid but retrieve poorly.
	 */
	pooling: "cls" | "mean"
	/** Prepended to queries before embedding. */
	queryPrefix: string
	/** Prepended to memories before embedding. Asymmetric models like e5 need it. */
	documentPrefix: string
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
	/**
	 * How long a tool call may wait for the model itself to load. Kept separate
	 * from toolTimeoutMs because the first load downloads weights, which takes
	 * far longer than any inference and would otherwise look like a failure.
	 */
	modelLoadTimeoutMs: number
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

export type ModelProfile = Pick<Config, "pooling" | "queryPrefix" | "documentPrefix" | "injectThreshold">

/**
 * Everything that has to match the model: the pooling and prefixes it was
 * trained with, and the similarity threshold its score distribution implies.
 *
 * All four travel together because none of them is portable. Mispooling a model
 * still yields plausible-looking vectors that retrieve measurably worse, and a
 * threshold tuned for one model is meaningless for another: bge-small separates
 * relevant from irrelevant pairs at 0.74 against 0.48, while multilingual-e5
 * puts the same split at 0.90 against 0.77.
 *
 * Thresholds are the F1-optimal value measured by `bun run bench`. Only models
 * that have actually been benchmarked are listed here.
 */
export const MODEL_PROFILES: Record<string, ModelProfile> = {
	"Xenova/paraphrase-multilingual-MiniLM-L12-v2": {
		pooling: "mean",
		queryPrefix: "",
		documentPrefix: "",
		injectThreshold: 0.51,
	},
	"Xenova/bge-small-en-v1.5": {
		pooling: "cls",
		queryPrefix: BGE_QUERY_PREFIX,
		documentPrefix: "",
		injectThreshold: 0.69,
	},
	"Xenova/multilingual-e5-small": {
		pooling: "mean",
		queryPrefix: "query: ",
		documentPrefix: "passage: ",
		injectThreshold: 0.88,
	},
	"Xenova/all-MiniLM-L6-v2": { pooling: "mean", queryPrefix: "", documentPrefix: "", injectThreshold: 0.42 },
}

/**
 * Family heuristics for a model with no measured profile. The threshold is a
 * guess in this case, so an unlisted model may need injectThreshold tuned by
 * hand; add it to the benchmark to find the right value.
 */
export function profileFor(model: string): ModelProfile {
	const known = MODEL_PROFILES[model]
	if (known) return known
	if (/e5/i.test(model))
		return { pooling: "mean", queryPrefix: "query: ", documentPrefix: "passage: ", injectThreshold: 0.88 }
	if (/bge/i.test(model))
		return { pooling: "cls", queryPrefix: BGE_QUERY_PREFIX, documentPrefix: "", injectThreshold: 0.69 }
	return { pooling: "mean", queryPrefix: "", documentPrefix: "", injectThreshold: 0.45 }
}

/**
 * Multilingual by default: it matched the best English recall in the benchmark
 * while being the only candidate to answer every cross-lingual query, and its
 * wide similarity gap makes the fixed injection threshold forgiving.
 */
export const DEFAULT_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"

export const DEFAULTS: Config = {
	dir: path.join(os.homedir(), ".config", "opencode", "memory"),
	embeddingModel: DEFAULT_MODEL,
	// Supplies pooling, both prefixes, and injectThreshold for the default model.
	...profileFor(DEFAULT_MODEL),
	topK: 5,
	keywordMinHits: 2,
	nearDupeThreshold: 0.95,
	duplicateThreshold: 0.92,
	maxPinned: 10,
	maxIndexLines: 30,
	indexMaxAgeDays: 90,
	hookTimeoutMs: 3000,
	toolTimeoutMs: 15000,
	modelLoadTimeoutMs: 180_000,
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
	modelLoadTimeoutMs: [1000, 1_800_000],
	embedderRetryMs: [0, 86_400_000],
	reinjectAfterTurns: [0, 1000],
	backfillBatch: [0, 500],
	maxStoreBytes: [1024, 1024 * 1024 * 1024],
	lockStaleMs: [1000, 600_000],
	lockRetries: [0, 100],
	lockRetryMs: [1, 5000],
}

const STRING_KEYS = ["dir", "embeddingModel", "queryPrefix", "documentPrefix"] as const

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

	// Apply the model first: it decides the pooling and prefix defaults that
	// explicit options are then allowed to override.
	const requestedModel =
		(typeof options?.embeddingModel === "string" ? options.embeddingModel : undefined) ??
		env.OPENCODE_MEMORY_MODEL
	if (requestedModel) {
		config.embeddingModel = requestedModel
		Object.assign(config, profileFor(requestedModel))
	}
	if (env.OPENCODE_MEMORY_QUERY_PREFIX !== undefined) config.queryPrefix = env.OPENCODE_MEMORY_QUERY_PREFIX

	for (const [key, value] of Object.entries(options ?? {})) {
		if (value === undefined || value === null) continue
		if (key === "embeddingModel") continue

		if (key === "pooling") {
			if (value !== "cls" && value !== "mean") {
				warnings.push(`option "pooling" must be "cls" or "mean", ignoring ${JSON.stringify(value)}`)
				continue
			}
			config.pooling = value
			continue
		}

		if ((STRING_KEYS as readonly string[]).includes(key)) {
			if (typeof value !== "string") {
				warnings.push(`option "${key}" must be a string, ignoring ${JSON.stringify(value)}`)
				continue
			}
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

	return { config, warnings }
}

/**
 * Identifies which settings produced a stored vector. Pooling and the document
 * prefix change the vector as much as the model does, so all three are compared
 * before a stored embedding is trusted; a change re-embeds via the backfill.
 */
export const embeddingSignature = (config: Config) =>
	`${config.embeddingModel}#${config.pooling}${config.documentPrefix ? `#${config.documentPrefix.trim()}` : ""}`
