import { DEFAULTS, embeddingSignature, profileFor, type Config } from "../src/config.ts"
import { embed, resetEmbedders } from "../src/embedding.ts"
import { score, tokenize } from "../src/scoring.ts"
import type { Memory } from "../src/types.ts"
import { CORPUS, QUERIES, type QueryKind } from "./dataset.ts"

const K = 5

type Candidate = { model: string; label: string; overrides?: Partial<Config> }

const CANDIDATES: Candidate[] = [
	{ model: "", label: "keyword only (no model)" },
	{ model: "Xenova/bge-small-en-v1.5", label: "bge-small-en-v1.5" },
	{ model: "Xenova/multilingual-e5-small", label: "multilingual-e5-small" },
	{
		model: "Xenova/multilingual-e5-small",
		label: "multilingual-e5-small [WRONG cls pooling]",
		overrides: { pooling: "cls" },
	},
	{ model: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", label: "paraphrase-multilingual-MiniLM-L12" },
	{ model: "Xenova/all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2 (english only)" },
]

const configFor = (c: Candidate): Config => ({
	...DEFAULTS,
	embeddingModel: c.model,
	...profileFor(c.model),
	...c.overrides,
})

type Row = {
	label: string
	recall: number
	mrr: number
	byKind: Record<QueryKind, number>
	bestThreshold: number
	f1: number
	noiseAtBest: number
	sim: { relevant: number; irrelevant: number }
	embedMs: number
}

async function evaluate(c: Candidate): Promise<Row | null> {
	const config = configFor(c)
	const useVectors = c.model !== ""

	const started = Date.now()
	const memories: Memory[] = []
	for (const m of CORPUS) {
		const vector = useVectors ? await embed(config, m.content, false) : null
		if (useVectors && !vector) {
			console.error(`  ! ${c.label}: failed to embed, skipping`)
			return null
		}
		memories.push({
			id: m.id,
			content: m.content,
			type: m.type,
			tags: m.tags,
			pinned: false,
			createdAt: 0,
			updatedAt: 0,
			embedding: vector ?? [],
			embeddingModel: vector ? embeddingSignature(config) : null,
		})
	}

	const scoredQueries: { relevant: string[]; kind: QueryKind; ranked: { id: string; s: number }[] }[] = []
	for (const q of QUERIES) {
		const queryEmbedding = useVectors ? await embed(config, q.q, true) : null
		const tokens = tokenize(q.q, true)
		const ranked = memories
			.map((m) => ({ id: m.id, s: score(config, m, queryEmbedding, tokens) }))
			.sort((a, b) => b.s - a.s)
		scoredQueries.push({ relevant: q.relevant, kind: q.kind, ranked })
	}
	const embedMs = Date.now() - started

	// Ranking quality over the queries that have a right answer.
	const labelled = scoredQueries.filter((q) => q.relevant.length > 0)
	let recall = 0
	let mrr = 0
	const kindHits: Record<string, { hit: number; n: number }> = {}
	for (const q of labelled) {
		const top = q.ranked.slice(0, K).map((r) => r.id)
		const found = q.relevant.filter((id) => top.includes(id)).length
		recall += found / q.relevant.length
		const rank = q.ranked.findIndex((r) => q.relevant.includes(r.id))
		mrr += rank >= 0 && rank < K ? 1 / (rank + 1) : 0
		const bucket = (kindHits[q.kind] ??= { hit: 0, n: 0 })
		bucket.hit += found > 0 ? 1 : 0
		bucket.n++
	}
	recall /= labelled.length
	mrr /= labelled.length

	// Similarity separation, which is what a fixed threshold actually sees.
	let relSum = 0
	let relN = 0
	let irrSum = 0
	let irrN = 0
	for (const q of scoredQueries) {
		for (const r of q.ranked) {
			if (q.relevant.includes(r.id)) {
				relSum += r.s
				relN++
			} else {
				irrSum += r.s
				irrN++
			}
		}
	}

	// Sweep the injection threshold: a model is only usable if some threshold
	// separates real hits from noise.
	let best = { threshold: 0, f1: 0, noise: 1 }
	for (let t = 0; t <= 1.001; t += 0.01) {
		let tp = 0
		let fp = 0
		let fn = 0
		let noisyNegatives = 0
		for (const q of scoredQueries) {
			// Same rule the message hook applies: score at or above the threshold,
			// capped at topK. Keyword-only scores top out around 0.18, so its best
			// threshold lands far lower than a cosine model's.
			const injected = q.ranked.filter((r) => r.s >= t && r.s > 0).slice(0, K)
			for (const r of injected) (q.relevant.includes(r.id) ? tp++ : fp++)
			fn += q.relevant.filter((id) => !injected.some((r) => r.id === id)).length
			if (q.kind === "negative" && injected.length > 0) noisyNegatives++
		}
		const precision = tp + fp ? tp / (tp + fp) : 0
		const recallAt = tp + fn ? tp / (tp + fn) : 0
		const f1 = precision + recallAt ? (2 * precision * recallAt) / (precision + recallAt) : 0
		const negatives = scoredQueries.filter((q) => q.kind === "negative").length
		if (f1 > best.f1) best = { threshold: t, f1, noise: noisyNegatives / negatives }
	}

	return {
		label: c.label,
		recall,
		mrr,
		byKind: Object.fromEntries(
			Object.entries(kindHits).map(([k, v]) => [k, v.hit / v.n]),
		) as Record<QueryKind, number>,
		bestThreshold: best.threshold,
		f1: best.f1,
		noiseAtBest: best.noise,
		sim: { relevant: relSum / relN, irrelevant: irrSum / irrN },
		embedMs,
	}
}

const pct = (n: number | undefined) => (n === undefined ? "  -  " : `${(n * 100).toFixed(0)}%`.padStart(5))

console.log(`corpus: ${CORPUS.length} memories, ${QUERIES.length} queries (k=${K})\n`)

const rows: Row[] = []
for (const c of CANDIDATES) {
	process.stderr.write(`evaluating ${c.label}...\n`)
	resetEmbedders()
	const row = await evaluate(c)
	if (row) rows.push(row)
}

const head = ["model", "recall@5", "MRR@5", "para", "lex", "xling", "best t", "F1", "noise", "embed"]
const widths = [38, 8, 6, 5, 5, 5, 6, 5, 5, 7]
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join(" ")

console.log(line(head))
console.log(widths.map((w) => "-".repeat(w)).join(" "))
for (const r of rows) {
	console.log(
		line([
			r.label,
			pct(r.recall),
			pct(r.mrr),
			pct(r.byKind.paraphrase),
			pct(r.byKind.lexical),
			pct(r.byKind.crosslingual),
			r.bestThreshold.toFixed(2),
			pct(r.f1),
			pct(r.noiseAtBest),
			`${(r.embedMs / (CORPUS.length + QUERIES.length)).toFixed(0)}ms`,
		]),
	)
}

console.log("\nsimilarity separation (mean cosine of relevant vs irrelevant pairs):")
for (const r of rows) {
	console.log(
		`  ${r.label.padEnd(38)} relevant ${r.sim.relevant.toFixed(3)}  irrelevant ${r.sim.irrelevant.toFixed(3)}  gap ${(r.sim.relevant - r.sim.irrelevant).toFixed(3)}`,
	)
}
const negativeCount = QUERIES.filter((q) => q.kind === "negative").length
console.log(
	`\nnoise = share of the ${negativeCount} nonsense queries that would still inject something at the best threshold.`,
)
console.log("'best t' is the injectThreshold that maximises F1 for that model; the default must match it.")
