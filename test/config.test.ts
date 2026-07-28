import { describe, expect, test } from "bun:test"
import { DEFAULTS, embeddingSignature, resolveConfig } from "../src/config.ts"

describe("config", () => {
	test("falls back to defaults with no options and no env", () => {
		const { config, warnings } = resolveConfig(undefined, {})
		expect(config).toEqual(DEFAULTS)
		expect(warnings).toEqual([])
	})

	test("plugin options win over environment", () => {
		const { config } = resolveConfig(
			{ dir: "/from/options", embeddingModel: "Xenova/other-bge" },
			{ OPENCODE_MEMORY_DIR: "/from/env", OPENCODE_MEMORY_MODEL: "Xenova/env-bge" },
		)
		expect(config.dir).toBe("/from/options")
		expect(config.embeddingModel).toBe("Xenova/other-bge")
	})

	test("environment still applies when no option is given", () => {
		const { config } = resolveConfig({}, { OPENCODE_MEMORY_DIR: "/from/env" })
		expect(config.dir).toBe("/from/env")
	})

	test("clamps out-of-range numbers and reports it", () => {
		const { config, warnings } = resolveConfig({ topK: 9999 }, {})
		expect(config.topK).toBe(50)
		expect(warnings.join()).toContain("topK")
	})

	test("ignores unknown and mistyped options instead of throwing", () => {
		const { config, warnings } = resolveConfig({ nope: 1, injectThreshold: "high" }, {})
		expect(config.injectThreshold).toBe(DEFAULTS.injectThreshold)
		expect(warnings).toHaveLength(2)
		expect(warnings.join()).toContain('unknown option "nope"')
		expect(warnings.join()).toContain("must be a finite number")
	})

	test("applies the pooling, prefixes and threshold the chosen model needs", () => {
		// Each of these is measured per model; carrying one model's values over to
		// another silently degrades retrieval rather than failing.
		const bge = resolveConfig({ embeddingModel: "Xenova/bge-small-en-v1.5" }, {}).config
		expect(bge.pooling).toBe("cls")
		expect(bge.queryPrefix).toContain("Represent this sentence")
		expect(bge.documentPrefix).toBe("")
		expect(bge.injectThreshold).toBe(0.77)

		const e5 = resolveConfig({ embeddingModel: "Xenova/multilingual-e5-small" }, {}).config
		expect(e5.pooling).toBe("mean")
		expect(e5.queryPrefix).toBe("query: ")
		expect(e5.documentPrefix).toBe("passage: ")
		expect(e5.injectThreshold).toBe(0.91)
	})

	test("guesses a profile by family for an unbenchmarked model", () => {
		expect(resolveConfig({ embeddingModel: "someone/bge-tiny-en" }, {}).config.pooling).toBe("cls")
		expect(resolveConfig({ embeddingModel: "someone/e5-tiny" }, {}).config.documentPrefix).toBe("passage: ")
		// Unknown family: mean pooling and no prefixes are the safer assumption.
		const unknown = resolveConfig({ embeddingModel: "someone/mystery-model" }, {}).config
		expect(unknown.pooling).toBe("mean")
		expect(unknown.queryPrefix).toBe("")
	})

	test("lets an explicit option override what the model profile chose", () => {
		const { config } = resolveConfig(
			{ embeddingModel: "Xenova/bge-small-en-v1.5", pooling: "mean", queryPrefix: "", injectThreshold: 0.4 },
			{},
		)
		expect(config.pooling).toBe("mean")
		expect(config.queryPrefix).toBe("")
		expect(config.injectThreshold).toBe(0.4)
	})

	test("rejects an invalid pooling value", () => {
		const { config, warnings } = resolveConfig({ pooling: "average" }, {})
		expect(config.pooling).toBe(DEFAULTS.pooling)
		expect(warnings.join()).toContain("pooling")
	})

	test("changing pooling or the document prefix invalidates stored vectors", () => {
		const a = resolveConfig({ embeddingModel: "Xenova/bge-small-en-v1.5" }, {}).config
		const b = resolveConfig({ embeddingModel: "Xenova/bge-small-en-v1.5", pooling: "mean" }, {}).config
		expect(embeddingSignature(a)).not.toBe(embeddingSignature(b))
	})
})
