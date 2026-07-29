import { embeddingSignature, type Config } from "./config.ts"
import { type Embedder, startEmbedder } from "./embedder-client.ts"

export type EmbedFn = (text: string, isQuery: boolean) => Promise<number[]>

type EmbedderState = {
	/** Set once the model is loaded, so callers can check readiness without awaiting. */
	fn: EmbedFn | null
	promise: Promise<EmbedFn | null> | null
	failedAt: number
	/** Absent when a test installed an embedder directly. */
	child: Embedder | null
	/** Identifies the attempt that owns this entry; see loadEmbedder. */
	generation: number
}

/** Monotonic across the module, so a stale callback can never match a live entry. */
let generations = 0

// Keyed by the full embedding signature, so two instances that differ only in
// pooling or prefix do not share one extractor.
const registry = new Map<string, EmbedderState>()

const stateFor = (model: string): EmbedderState => {
	let state = registry.get(model)
	if (!state) {
		state = { fn: null, promise: null, failedAt: 0, child: null, generation: ++generations }
		registry.set(model, state)
	}
	return state
}

export const resetEmbedders = () => {
	for (const state of registry.values()) state.child?.kill()
	registry.clear()
}

/**
 * Diagnostics sink. The embedder now lives in a separate process, so a failure
 * to start it is worth surfacing rather than silently degrading to keywords.
 */
let warn: (message: string) => void = () => {}
export const setEmbedderLogger = (log: (message: string) => void) => {
	warn = log
}

/**
 * Installs an embedder directly, bypassing the worker process. Tests use this
 * to exercise both the ready and unavailable paths deterministically; passing
 * null marks the model as just-failed so no load is attempted.
 */
export function setEmbedder(model: string, fn: EmbedFn | null) {
	registry.get(model)?.child?.kill()
	registry.set(model, { fn, promise: null, failedAt: fn ? 0 : Date.now(), child: null, generation: ++generations })
}

export const isEmbedderReady = (config: Config) => stateFor(embeddingSignature(config)).fn !== null

/** Starts the worker process if it is not running yet. Never throws. */
function loadEmbedder(config: Config): Promise<EmbedFn | null> {
	const signature = embeddingSignature(config)
	const state = stateFor(signature)
	if (state.fn) return Promise.resolve(state.fn)
	if (state.promise) return state.promise
	if (state.failedAt && Date.now() - state.failedAt < config.embedderRetryMs) return Promise.resolve(null)

	state.promise = (async () => {
		// Identifies this attempt. onExit must not close over the embedder it is
		// handed to, because it can fire before that binding is initialised: a
		// spawn error settles the start promise and reports the exit in the same
		// synchronous turn, before the await below has resumed.
		const generation = ++generations
		state.generation = generation
		let exited = false

		// The worker also leaves on its own once it has been idle long enough, so
		// forget it here and let the next call start a new one.
		const onExit = (served: boolean) => {
			exited = true
			const current = registry.get(signature)
			if (!current || current.generation !== generation) return
			current.fn = null
			current.child = null
			// A worker that never answered anything is failing, not idling. Without
			// a backoff every message would spawn a new one and reload the model.
			if (!served) current.failedAt = Date.now()
		}

		try {
			const embedder = await startEmbedder(config, { onWarn: warn, onExit })
			// A worker that died between reporting ready and getting here must not
			// be installed, or every later call would use a dead pipe.
			if (!embedder || exited) {
				embedder?.kill()
				state.failedAt = Date.now()
				return null
			}
			state.fn = embedder.embed
			state.child = embedder
			state.failedAt = 0
			return embedder.embed
		} catch (e) {
			// Allow a retry, but not on every turn.
			warn(`the embedder could not be started: ${e}`)
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

/**
 * Embeds, waiting for the model to load if necessary. For tool calls only.
 *
 * Tries twice, because the worker can leave between two calls: its idle timeout
 * can expire just as a request is being written, and the caller should not see
 * that as a failure. The second attempt starts a fresh worker, and a genuinely
 * broken one is held off by the backoff in loadEmbedder rather than retried here.
 */
export async function embed(config: Config, text: string, isQuery: boolean): Promise<number[] | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fn = await withTimeout(loadEmbedder(config), config.modelLoadTimeoutMs)
			if (!fn) return null
			return await withTimeout(fn(text, isQuery), config.toolTimeoutMs)
		} catch {
			// The worker went away mid-request; loop to pick up a new one.
		}
	}
	return null
}
