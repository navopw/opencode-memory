import { describe, expect, test } from "bun:test"
import { DEFAULTS, resolveConfig } from "../src/config.ts"

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

	test("drops the bge instruction prefix for models that were not trained with it", () => {
		expect(resolveConfig({ embeddingModel: "Xenova/all-MiniLM-L6-v2" }, {}).config.queryPrefix).toBe("")
		expect(resolveConfig({ embeddingModel: "Xenova/bge-base-en-v1.5" }, {}).config.queryPrefix).toBe(
			DEFAULTS.queryPrefix,
		)
	})

	test("keeps an explicitly configured prefix for any model", () => {
		const { config } = resolveConfig({ embeddingModel: "Xenova/all-MiniLM-L6-v2", queryPrefix: "query: " }, {})
		expect(config.queryPrefix).toBe("query: ")
	})
})
