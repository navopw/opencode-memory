import { embeddingSignature, type Config } from "./config.ts"

export type EmbedFn = (text: string, isQuery: boolean) => Promise<number[]>

type EmbedderState = {
	/** Set once the model is loaded, so callers can check readiness without awaiting. */
	fn: EmbedFn | null
	promise: Promise<EmbedFn | null> | null
	failedAt: number
}

// Keyed by the full embedding signature, so two instances that differ only in
// pooling or prefix do not share one extractor.
const registry = new Map<string, EmbedderState>()

const stateFor = (model: string): EmbedderState => {
	let state = registry.get(model)
	if (!state) {
		state = { fn: null, promise: null, failedAt: 0 }
		registry.set(model, state)
	}
	return state
}

export const resetEmbedders = () => registry.clear()

/**
 * Installs an embedder directly, bypassing the model download. Tests use this
 * to exercise both the ready and unavailable paths deterministically; passing
 * null marks the model as just-failed so no load is attempted.
 */
export function setEmbedder(model: string, fn: EmbedFn | null) {
	registry.set(model, { fn, promise: null, failedAt: fn ? 0 : Date.now() })
}

export const isEmbedderReady = (config: Config) => stateFor(embeddingSignature(config)).fn !== null

/** Starts the model load if it is not running yet. Never throws. */
function loadEmbedder(config: Config): Promise<EmbedFn | null> {
	const state = stateFor(embeddingSignature(config))
	if (state.fn) return Promise.resolve(state.fn)
	if (state.promise) return state.promise
	if (state.failedAt && Date.now() - state.failedAt < config.embedderRetryMs) return Promise.resolve(null)

	state.promise = (async () => {
		try {
			const { pipeline } = await import("@huggingface/transformers")
			const extractor = await pipeline("feature-extraction", config.embeddingModel)
			const fn: EmbedFn = async (text, isQuery) => {
				const input = (isQuery ? config.queryPrefix : config.documentPrefix) + text.slice(0, 2000)
				const out = await extractor(input, { pooling: config.pooling, normalize: true })
				return out.tolist()[0] as number[]
			}
			state.fn = fn
			state.failedAt = 0
			return fn
		} catch {
			// Allow a retry, but not on every turn.
			state.failedAt = Date.now()
			return null
		} finally {
			state.promise = null
		}
	})()

	return state.promise
}

export const warmEmbedder = (config: Config) => {
	void loadEmbedder(config)
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => resolve(null), ms)
		promise.then(resolve, reject).finally(() => clearTimeout(timer))
	})

/**
 * Embeds only if the model is already resident. The first model load downloads
 * weights and can take minutes, and hooks run on every user message, so waiting
 * here would stall every turn for the full timeout.
 */
export async function embedIfReady(config: Config, text: string, isQuery: boolean): Promise<number[] | null> {
	const state = stateFor(embeddingSignature(config))
	if (!state.fn) {
		warmEmbedder(config)
		return null
	}
	try {
		return await withTimeout(state.fn(text, isQuery), config.hookTimeoutMs)
	} catch {
		return null
	}
}

/** Embeds, waiting for the model to load if necessary. For tool calls only. */
export async function embed(config: Config, text: string, isQuery: boolean): Promise<number[] | null> {
	try {
		const fn = await withTimeout(loadEmbedder(config), config.modelLoadTimeoutMs)
		if (!fn) return null
		return await withTimeout(fn(text, isQuery), config.toolTimeoutMs)
	} catch {
		return null
	}
}
