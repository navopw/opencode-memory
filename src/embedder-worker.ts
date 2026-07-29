/**
 * Child process that owns the ONNX runtime. Never imported by the plugin.
 *
 * onnxruntime-node is a NAPI addon, and loading it into the OpenCode process
 * turns every Ctrl+C into a hard crash: Bun tears down the JS VM while the
 * addon still holds native state, the addon then creates a JS error through a
 * dead napi_env, and Bun panics with "NAPI FATAL ERROR: Error::New
 * napi_create_error". Running the addon here keeps the host from ever dlopening
 * it, which is the only reliable way to avoid that teardown path.
 *
 * Protocol: newline-delimited JSON, requests on stdin, responses on stdout.
 *   in   {"id":1,"text":"...","isQuery":true}
 *   out  {"id":1,"vector":[...]}  |  {"id":1,"error":"..."}
 *   boot {"ready":true}           |  {"ready":false,"error":"..."}
 */
export {}

// stdout is the protocol channel, and transformers.js writes progress and
// warnings to it. Move that chatter to stderr before the library is loaded.
console.log = console.info = console.debug = console.warn = (...args: unknown[]) => console.error(...args)

type WorkerConfig = {
	model: string
	pooling: "cls" | "mean"
	queryPrefix: string
	documentPrefix: string
	idleMs: number
	maxChars: number
}

type EmbedRequest = { id: number; text: string; isQuery: boolean }

const send = (message: unknown) => {
	try {
		process.stdout.write(`${JSON.stringify(message)}\n`)
	} catch {
		// The parent is gone; the stdin watcher below will end the process.
	}
}

/**
 * Leaves without running JS or native teardown. Exiting cleanly would unwind
 * the ONNX runtime through NAPI, which is exactly the crash this process exists
 * to keep away from the host.
 */
const hardExit = (): never => {
	process.kill(process.pid, "SIGKILL")
	throw new Error("unreachable")
}

const parseConfig = (): WorkerConfig => {
	const raw = process.argv[2]
	if (!raw) {
		send({ ready: false, error: "worker started without a config argument" })
		hardExit()
	}
	return JSON.parse(raw) as WorkerConfig
}

const config = parseConfig()

let idleTimer: ReturnType<typeof setTimeout> | undefined
/** A host that stopped asking is a host that no longer needs a resident model. */
const resetIdle = () => {
	if (idleTimer) clearTimeout(idleTimer)
	idleTimer = setTimeout(hardExit, config.idleMs)
	idleTimer.unref?.()
}

// The parent's end of the pipe closes when OpenCode exits, whether it exited
// cleanly or was killed. Either way there is nothing left to serve.
process.stdin.on("end", hardExit)
process.stdin.on("close", hardExit)
process.stdin.on("error", hardExit)

type Extractor = (
	input: string,
	options: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>

let extractor: Extractor
try {
	const { pipeline } = await import("@huggingface/transformers")
	extractor = (await pipeline("feature-extraction", config.model)) as unknown as Extractor
	send({ ready: true })
} catch (e) {
	send({ ready: false, error: String(e) })
	hardExit()
}

async function handle(line: string) {
	let request: EmbedRequest
	try {
		request = JSON.parse(line) as EmbedRequest
	} catch {
		return
	}
	resetIdle()
	try {
		const prefix = request.isQuery ? config.queryPrefix : config.documentPrefix
		const output = await extractor(prefix + request.text.slice(0, config.maxChars), {
			pooling: config.pooling,
			normalize: true,
		})
		send({ id: request.id, vector: output.tolist()[0] })
	} catch (e) {
		send({ id: request.id, error: String(e) })
	}
	resetIdle()
}

let buffered = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
	buffered += chunk
	for (;;) {
		const newline = buffered.indexOf("\n")
		if (newline < 0) break
		const line = buffered.slice(0, newline).trim()
		buffered = buffered.slice(newline + 1)
		if (line) void handle(line)
	}
})

resetIdle()
