import { embeddingSignature, STOPWORDS, type Config } from "./config.ts"
import type { Memory } from "./types.ts"

export const tokenize = (text: string, filterStopwords = false): string[] => {
	const tokens = [
		...new Set(
			text
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.filter((t) => t.length > 2),
		),
	]
	return filterStopwords ? tokens.filter((t) => !STOPWORDS.has(t)) : tokens
}

/**
 * Crude stemmer for keyword matching: handles plurals and common suffixes so
 * "editor" matches "editors", while "cat" still does not match "concatenate".
 */
export const stem = (t: string): string => {
	if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3)
	if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2)
	if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1)
	return t
}

export const keywordHits = (m: Memory, queryTokens: string[]): number => {
	if (!queryTokens.length) return 0
	const haystack = new Set(tokenize(`${m.content} ${m.tags.join(" ")}`).map(stem))
	let hits = 0
	for (const t of queryTokens) if (haystack.has(stem(t))) hits++
	return hits
}

/** Vectors are normalized, so dot product equals cosine similarity. */
export const cosine = (a: number[], b: number[]) => {
	if (!a.length || !b.length || a.length !== b.length) return 0
	let s = 0
	for (let i = 0; i < a.length; i++) s += a[i] * b[i]
	return s
}

/** True when the memory's vector was produced by the model we are querying with. */
export const isComparable = (m: Memory, config: Config) =>
	m.embedding.length > 0 && m.embeddingModel === embeddingSignature(config)

/** Scoring: cosine + exact-token keyword boost + pinned boost. */
export function score(config: Config, m: Memory, queryEmbedding: number[] | null, queryTokens: string[]): number {
	let s = queryEmbedding && isComparable(m, config) ? cosine(queryEmbedding, m.embedding) : 0
	s += Math.min(0.18, keywordHits(m, queryTokens) * 0.06)
	if (m.pinned) s += 0.05
	return s
}

/**
 * Relevance is decided per memory, not per query. A memory whose vector is
 * missing or came from a different model can never reach the cosine threshold,
 * so it is judged on keywords alone instead of being silently unreachable.
 */
export function isRelevant(
	config: Config,
	m: Memory,
	scored: number,
	queryEmbedding: number[] | null,
	queryTokens: string[],
): boolean {
	if (queryEmbedding && isComparable(m, config)) return scored >= config.injectThreshold
	const required = Math.max(1, Math.min(config.keywordMinHits, queryTokens.length))
	return keywordHits(m, queryTokens) >= required
}

/** Skip hits that are near-duplicates of an already-selected hit. */
export function diversify<T extends { m: Memory }>(config: Config, hits: T[], k: number): T[] {
	const out: T[] = []
	for (const h of hits) {
		if (out.length >= k) break
		const dup = out.some(
			(o) =>
				isComparable(o.m, config) &&
				isComparable(h.m, config) &&
				cosine(o.m.embedding, h.m.embedding) >= config.nearDupeThreshold,
		)
		if (!dup) out.push(h)
	}
	return out
}
