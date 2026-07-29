/**
 * Speaks the embedder protocol without loading a model, so the client can be
 * tested for real: a spawned process, a handshake, and stdio framing.
 *
 * FAKE_EMBEDDER_MODE picks the behaviour under test:
 *   ready       answer every request (default)
 *   fail-load   report that the model could not be loaded, then leave
 *   exit-early  leave after the handshake, without answering
 *   crash       leave on the first request, without answering it
 *   serve-once  answer one request, then leave
 *
 * FAKE_EMBEDDER_SPAWN_LOG, when set, gets a line per start, so a test can count
 * how often the host decided to spawn.
 */
import * as fs from "node:fs"

type Options = { queryPrefix: string; documentPrefix: string }

const mode = process.env.FAKE_EMBEDDER_MODE ?? "ready"
if (process.env.FAKE_EMBEDDER_SPAWN_LOG) fs.appendFileSync(process.env.FAKE_EMBEDDER_SPAWN_LOG, "spawn\n")
const options = JSON.parse(process.argv[2] ?? "{}") as Options
const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)

if (mode === "fail-load") {
	send({ ready: false, error: "fake load failure" })
	process.exit(0)
}

send({ ready: true })

if (mode === "exit-early") process.exit(0)

// The prefix is echoed into the vector so tests can prove the worker received
// the query/document distinction rather than guessing it.
const vectorFor = (text: string, isQuery: boolean) => {
	const prefixed = (isQuery ? options.queryPrefix : options.documentPrefix) + text
	let hash = 0
	for (let i = 0; i < prefixed.length; i++) hash = (hash * 31 + prefixed.charCodeAt(i)) >>> 0
	return [prefixed.length, hash % 1000, isQuery ? 1 : 0]
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
		if (!line) continue
		const request = JSON.parse(line) as { id: number; text: string; isQuery: boolean }
		if (mode === "crash") process.exit(1)
		if (request.text === "__fail__") send({ id: request.id, error: "fake embed failure" })
		else send({ id: request.id, vector: vectorFor(request.text, request.isQuery) })
		if (mode === "serve-once") process.exit(0)
	}
})
process.stdin.on("end", () => process.exit(0))
