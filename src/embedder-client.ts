/**
 * Host side of the out-of-process embedder. Spawns `embedder-worker.ts` and
 * talks to it over newline-delimited JSON, so the ONNX NAPI addon is never
 * loaded into the OpenCode process. See the worker for why that matters.
 */
import { spawn } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { Config } from "./config.ts"
import type { EmbedFn } from "./embedding.ts"

/** Matches the truncation the in-process embedder used before this split. */
const MAX_CHARS = 2000

/** Kept small: it only ever holds a startup failure worth reporting. */
const STDERR_TAIL = 4000

export type Embedder = { embed: EmbedFn; kill: () => void }

export type EmbedderEvents = {
	onWarn: (message: string) => void
	/** Fired once when the worker is gone, so the caller can drop and respawn it. */
	onExit: () => void
}

/**
 * The worker sits next to this file, and the build rewrites `.ts` specifiers to
 * `.js`. Deriving the extension from this module's own path picks the right one
 * whether the plugin runs from `src` (a source checkout) or `dist` (npm).
 */
const workerPath = (): string => {
	const here = fileURLToPath(import.meta.url)
	return path.join(path.dirname(here), here.endsWith(".ts") ? "embedder-worker.ts" : "embedder-worker.js")
}

/**
 * A plain `bun` binary runs the worker as-is. OpenCode instead ships as a Bun
 * standalone executable, whose execPath re-runs OpenCode rather than a script;
 * BUN_BE_BUN makes such a binary behave as the bun CLI. Set
 * OPENCODE_MEMORY_RUNTIME to point at a different interpreter.
 */
const runtime = (): { command: string; env: NodeJS.ProcessEnv } => {
	const override = process.env.OPENCODE_MEMORY_RUNTIME
	if (override) return { command: override, env: { ...process.env } }

	const command = process.execPath
	const base = path.basename(command).toLowerCase().replace(/\.exe$/, "")
	const isPlainBun = base === "bun" || base.startsWith("bun-")
	return { command, env: isPlainBun ? { ...process.env } : { ...process.env, BUN_BE_BUN: "1" } }
}

/**
 * Starts the worker and resolves once its model is resident. Resolves null if
 * the process cannot start or the model fails to load; the caller then falls
 * back to keyword retrieval.
 */
export function startEmbedder(config: Config, events: EmbedderEvents): Promise<Embedder | null> {
	const { command, env } = runtime()
	const worker = workerPath()
	const options = {
		model: config.embeddingModel,
		pooling: config.pooling,
		queryPrefix: config.queryPrefix,
		documentPrefix: config.documentPrefix,
		idleMs: config.embedderIdleMs,
		maxChars: MAX_CHARS,
	}

	let child: ReturnType<typeof spawn>
	try {
		child = spawn(command, [worker, JSON.stringify(options)], {
			// Its own process group, so the terminal's Ctrl+C never reaches it.
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
			env,
			cwd: path.dirname(worker),
		})
	} catch (e) {
		events.onWarn(`could not start the embedder process: ${e}`)
		return Promise.resolve(null)
	}

	const pending = new Map<number, { reject: (e: Error) => void; resolve: (vector: number[]) => void }>()
	let nextId = 1
	let alive = true
	let stderr = ""

	const kill = () => {
		if (!alive) return
		alive = false
		for (const { reject } of pending.values()) reject(new Error("the embedder process went away"))
		pending.clear()
		// SIGKILL, not SIGTERM: a graceful exit would unwind ONNX through NAPI.
		try {
			child.kill("SIGKILL")
		} catch {
			// Already gone.
		}
	}

	// Nothing here should hold OpenCode open; the worker notices the closed pipe
	// on its own and leaves. Stream handles are unreffed too, and not every
	// runtime implements it on them.
	const unref = (stream: unknown) => (stream as { unref?: () => void } | null)?.unref?.()
	child.unref()
	unref(child.stdin)
	unref(child.stdout)
	unref(child.stderr)

	child.stderr?.setEncoding("utf8")
	child.stderr?.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-STDERR_TAIL)
	})

	return new Promise<Embedder | null>((resolve) => {
		let settled = false
		const settle = (value: Embedder | null) => {
			if (settled) return
			settled = true
			if (!value) kill()
			resolve(value)
		}

		// Rejects rather than resolving null, matching what an in-process model
		// failure looked like; every caller already treats both the same way.
		const embed: EmbedFn = (text, isQuery) =>
			new Promise<number[]>((resolveEmbed, rejectEmbed) => {
				if (!alive) return rejectEmbed(new Error("the embedder process is not running"))
				const id = nextId++
				pending.set(id, { resolve: resolveEmbed, reject: rejectEmbed })
				try {
					child.stdin?.write(`${JSON.stringify({ id, text, isQuery })}\n`)
				} catch (e) {
					pending.delete(id)
					rejectEmbed(new Error(`could not reach the embedder: ${e}`))
				}
			})

		const onMessage = (message: Record<string, unknown>) => {
			if (typeof message.ready === "boolean") {
				if (message.ready) return settle({ embed, kill })
				events.onWarn(`the embedder could not load ${config.embeddingModel}: ${message.error}`)
				return settle(null)
			}
			if (typeof message.id !== "number") return
			const waiter = pending.get(message.id)
			if (!waiter) return
			pending.delete(message.id)
			if (Array.isArray(message.vector)) waiter.resolve(message.vector as number[])
			else waiter.reject(new Error(String(message.error ?? "the embedder returned no vector")))
		}

		let buffered = ""
		child.stdout?.setEncoding("utf8")
		child.stdout?.on("data", (chunk: string) => {
			buffered += chunk
			for (;;) {
				const newline = buffered.indexOf("\n")
				if (newline < 0) break
				const line = buffered.slice(0, newline).trim()
				buffered = buffered.slice(newline + 1)
				if (!line) continue
				try {
					onMessage(JSON.parse(line) as Record<string, unknown>)
				} catch {
					// Not our protocol; ignore rather than tear the worker down.
				}
			}
		})

		child.on("error", (e) => {
			if (!settled) events.onWarn(`the embedder process failed: ${e}`)
			kill()
			settle(null)
			events.onExit()
		})

		child.on("exit", () => {
			const tail = stderr.trim()
			if (!settled) events.onWarn(`the embedder exited before it was ready${tail ? `: ${tail}` : ""}`)
			kill()
			settle(null)
			events.onExit()
		})
	})
}
