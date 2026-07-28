import { describe, expect, test } from "bun:test"
import { cosine, diversify, isComparable, isRelevant, keywordHits, score, stem, tokenize } from "../src/scoring.ts"
import { memory, tmpConfig, TEST_SIGNATURE } from "./helpers.ts"

const config = tmpConfig()

describe("tokenizing", () => {
	test("drops short tokens and stopwords, and de-duplicates", () => {
		expect(tokenize("The user is a user of pnpm", true)).toEqual(["user", "pnpm"])
	})

	test("stems plurals and common suffixes without over-reaching", () => {
		expect(stem("editors")).toBe("editor")
		expect(stem("running")).toBe("runn")
		expect(stem("cat")).toBe("cat")
		expect(stem("class")).toBe("class")
	})

	test("counts keyword hits across content and tags", () => {
		expect(keywordHits(memory(), ["packages", "management"])).toBe(2)
		expect(keywordHits(memory(), ["unrelated"])).toBe(0)
	})
})

describe("cosine", () => {
	test("is a dot product for normalized vectors, and 0 for mismatches", () => {
		expect(cosine([1, 0], [1, 0])).toBe(1)
		expect(cosine([1, 0], [0, 1])).toBe(0)
		expect(cosine([1, 0], [])).toBe(0)
		expect(cosine([1, 0], [1, 0, 0])).toBe(0)
	})
})

describe("score", () => {
	test("ignores vectors produced by a different embedding model", () => {
		expect(score(config, memory(), [1, 0], [])).toBe(1)
		expect(score(config, memory({ embeddingModel: "another/model" }), [1, 0], [])).toBe(0)
		expect(score(config, memory({ embedding: [] }), [1, 0], [])).toBe(0)
	})

	test("adds a bounded keyword boost and a pinned boost", () => {
		expect(score(config, memory({ embedding: [] }), null, ["packages"])).toBeCloseTo(0.06)
		expect(score(config, memory({ embedding: [], pinned: true }), null, ["packages"])).toBeCloseTo(0.11)
		// Boost is capped regardless of how many tokens match.
		const many = memory({ embedding: [], content: "a b c d e f g h i j".split(" ").join(" ") })
		expect(score(config, many, null, [])).toBe(0)
	})
})

describe("relevance", () => {
	test("uses the cosine threshold when the vector is comparable", () => {
		expect(isComparable(memory(), config)).toBe(true)
		expect(isRelevant(config, memory(), 0.6, [1, 0], [])).toBe(true)
		expect(isRelevant(config, memory(), 0.4, [1, 0], [])).toBe(false)
	})

	test("falls back to keywords for a memory whose vector cannot be compared", () => {
		// Regression: these can never reach injectThreshold on cosine, because
		// their similarity is forced to 0. Without a keyword path they would be
		// permanently unreachable after an embedder outage or a model change.
		const stale = memory({ embeddingModel: "another/model" })
		const missing = memory({ embedding: [], embeddingModel: null })
		const tokens = ["pnpm", "package"]

		expect(score(config, stale, [1, 0], tokens)).toBeLessThan(config.injectThreshold)
		expect(isRelevant(config, stale, score(config, stale, [1, 0], tokens), [1, 0], tokens)).toBe(true)
		expect(isRelevant(config, missing, 0, [1, 0], tokens)).toBe(true)
		expect(isRelevant(config, missing, 0, [1, 0], ["unrelated", "words"])).toBe(false)
	})

	test("requires fewer keyword hits than configured when the query is short", () => {
		const missing = memory({ embedding: [] })
		expect(config.keywordMinHits).toBe(2)
		expect(isRelevant(config, missing, 0, [1, 0], ["pnpm"])).toBe(true)
	})
})

describe("diversify", () => {
	test("skips near-duplicates but keeps distinct memories", () => {
		const hits = [
			{ m: memory({ id: "a", embedding: [1, 0] }) },
			{ m: memory({ id: "b", embedding: [0.999, 0.0447] }) },
			{ m: memory({ id: "c", embedding: [0, 1] }) },
		]
		expect(diversify(config, hits, 5).map((h) => h.m.id)).toEqual(["a", "c"])
	})

	test("cannot compare across models, so it keeps both", () => {
		const hits = [
			{ m: memory({ id: "a", embedding: [1, 0] }) },
			{ m: memory({ id: "b", embedding: [1, 0], embeddingModel: "another/model" }) },
		]
		expect(diversify(config, hits, 5)).toHaveLength(2)
	})

	test("honours the requested limit", () => {
		const vectors = [
			[1, 0],
			[0, 1],
			[0.6, 0.8],
		]
		const hits = vectors.map((embedding, i) => ({
			m: memory({ id: `m${i}`, embedding, embeddingModel: TEST_SIGNATURE }),
		}))
		expect(diversify(config, hits, 2)).toHaveLength(2)
	})
})
