import type { MemoryType } from "../src/types.ts"

export type BenchMemory = { id: string; content: string; type: MemoryType; tags: string[] }

/**
 * A plausible store for a German developer working in an English codebase:
 * mostly English memories, some German ones, several deliberately close
 * together so the ranking has to discriminate rather than just match a topic.
 */
export const CORPUS: BenchMemory[] = [
	{ id: "pnpm", content: "This project uses pnpm as its package manager, never npm or yarn", type: "fact", tags: ["tooling"] },
	{ id: "bun-test", content: "Run the test suite with bun test, not vitest", type: "fact", tags: ["testing"] },
	{ id: "tabs", content: "The user prefers tabs over spaces for indentation", type: "preference", tags: ["style"] },
	{ id: "no-semis", content: "Code style omits semicolons at the end of statements", type: "preference", tags: ["style"] },
	{ id: "ci", content: "CI runs on GitHub Actions, the workflow lives in .github/workflows/ci.yml", type: "fact", tags: ["ci"] },
	{ id: "deploy", content: "Deployments go to the staging cluster first and are promoted manually", type: "decision", tags: ["deploy"] },
	{ id: "db", content: "We chose Postgres over MySQL because of native JSONB support", type: "decision", tags: ["database"] },
	{ id: "migrations", content: "Database migrations live in db/migrations and run automatically on boot", type: "fact", tags: ["database"] },
	{ id: "auth", content: "Authentication uses short-lived JWTs with refresh tokens stored in httpOnly cookies", type: "decision", tags: ["auth"] },
	{ id: "secrets", content: "Secrets come from 1Password via the op CLI, never from committed .env files", type: "fact", tags: ["security"] },
	{ id: "api-style", content: "The HTTP API is REST, not GraphQL, and returns snake_case JSON keys", type: "decision", tags: ["api"] },
	{ id: "errors", content: "Errors are returned as typed result objects rather than thrown exceptions", type: "decision", tags: ["api"] },
	{ id: "logging", content: "Structured logging goes through pino, plain console.log is not allowed in src", type: "fact", tags: ["observability"] },
	{ id: "metrics", content: "Prometheus scrapes the /metrics endpoint every 15 seconds", type: "fact", tags: ["observability"] },
	{ id: "review", content: "The user wants small pull requests, under roughly 400 changed lines", type: "preference", tags: ["process"] },
	{ id: "commits", content: "Commit messages follow conventional commits, for example feat: or fix:", type: "preference", tags: ["process"] },
	{ id: "no-comments", content: "Do not add explanatory comments for obvious code, only for non-obvious decisions", type: "preference", tags: ["style"] },
	{ id: "german-docs", content: "Kundendokumentation wird auf Deutsch geschrieben, der Code bleibt auf Englisch", type: "decision", tags: ["docs"] },
	{ id: "german-invoice", content: "Rechnungen müssen zehn Jahre lang aufbewahrt werden, das ist eine gesetzliche Vorgabe", type: "fact", tags: ["legal"] },
	{ id: "german-standup", content: "Das tägliche Standup ist um 9:30 Uhr und dauert maximal fünfzehn Minuten", type: "fact", tags: ["process"] },
	{ id: "timezone", content: "All timestamps are stored in UTC and only converted for display", type: "decision", tags: ["dates"] },
	{ id: "cache", content: "Redis caches session data with a 30 minute TTL", type: "fact", tags: ["cache"] },
	{ id: "rate-limit", content: "The public API is rate limited to 100 requests per minute per key", type: "fact", tags: ["api"] },
	{ id: "monorepo", content: "The repository is a monorepo managed with turborepo, packages live under packages/", type: "fact", tags: ["tooling"] },
	{ id: "node-version", content: "The project targets Node 22, older runtimes are not supported", type: "fact", tags: ["tooling"] },
	{ id: "css", content: "Styling uses Tailwind, no CSS modules and no styled-components", type: "decision", tags: ["frontend"] },
	{ id: "state", content: "Frontend state is handled with Zustand rather than Redux", type: "decision", tags: ["frontend"] },
	{ id: "todo-flaky", content: "TODO: the payment webhook test is flaky and needs a proper fake clock", type: "todo", tags: ["testing"] },
	{ id: "todo-index", content: "TODO: add a database index on orders.created_at, queries are slow", type: "todo", tags: ["database"] },
	{ id: "backup", content: "Database backups run nightly at 02:00 and are kept for 30 days", type: "fact", tags: ["database"] },
]

export type QueryKind = "paraphrase" | "lexical" | "crosslingual" | "negative"

export type BenchQuery = {
	q: string
	kind: QueryKind
	/** Memory ids that genuinely answer the query. Empty for negatives. */
	relevant: string[]
}

/**
 * Paraphrase queries deliberately avoid reusing the memory's wording, so a
 * keyword-only baseline cannot score well on them. Negatives carry no relevant
 * memory at all and exist to measure how often a config injects noise.
 */
export const QUERIES: BenchQuery[] = [
	// Semantic paraphrase, little or no lexical overlap.
	{ q: "which tool should I use to install dependencies", kind: "paraphrase", relevant: ["pnpm"] },
	{ q: "how do I run the specs", kind: "paraphrase", relevant: ["bun-test"] },
	{ q: "what indentation style does this codebase use", kind: "paraphrase", relevant: ["tabs", "no-semis"] },
	{ q: "where is the continuous integration configured", kind: "paraphrase", relevant: ["ci"] },
	{ q: "how does code reach production", kind: "paraphrase", relevant: ["deploy"] },
	{ q: "which relational engine did we settle on and why", kind: "paraphrase", relevant: ["db"] },
	{ q: "how do users stay signed in between visits", kind: "paraphrase", relevant: ["auth"] },
	{ q: "where do credentials come from", kind: "paraphrase", relevant: ["secrets"] },
	{ q: "should the endpoint return camelCase fields", kind: "paraphrase", relevant: ["api-style"] },
	{ q: "how should a function signal that something went wrong", kind: "paraphrase", relevant: ["errors"] },
	{ q: "can I print debugging output to stdout", kind: "paraphrase", relevant: ["logging"] },
	{ q: "how big should a change request be", kind: "paraphrase", relevant: ["review"] },
	{ q: "how do I write the commit subject line", kind: "paraphrase", relevant: ["commits"] },
	{ q: "should I document every line I write", kind: "paraphrase", relevant: ["no-comments"] },
	{ q: "how are dates persisted", kind: "paraphrase", relevant: ["timezone"] },
	{ q: "what should I use for styling components", kind: "paraphrase", relevant: ["css"] },
	{ q: "which store library for the client", kind: "paraphrase", relevant: ["state"] },
	{ q: "what is currently broken in the test suite", kind: "paraphrase", relevant: ["todo-flaky"] },
	{ q: "why are the order queries slow", kind: "paraphrase", relevant: ["todo-index"] },
	{ q: "how often is data backed up", kind: "paraphrase", relevant: ["backup"] },

	// Direct lexical overlap, the easy case a keyword baseline should also get.
	{ q: "pnpm package manager", kind: "lexical", relevant: ["pnpm"] },
	{ q: "prometheus metrics endpoint", kind: "lexical", relevant: ["metrics"] },
	{ q: "redis session cache ttl", kind: "lexical", relevant: ["cache"] },
	{ q: "turborepo monorepo packages", kind: "lexical", relevant: ["monorepo"] },
	{ q: "rate limited requests per minute", kind: "lexical", relevant: ["rate-limit"] },

	// German query, English memory, and German query against German memory.
	{ q: "welchen paketmanager soll ich benutzen", kind: "crosslingual", relevant: ["pnpm"] },
	{ q: "wie werden passwörter und zugangsdaten verwaltet", kind: "crosslingual", relevant: ["secrets"] },
	{ q: "in welcher zeitzone werden zeitstempel gespeichert", kind: "crosslingual", relevant: ["timezone"] },
	{ q: "wann ist das tägliche meeting", kind: "crosslingual", relevant: ["german-standup"] },
	{ q: "wie lange muss ich rechnungen aufheben", kind: "crosslingual", relevant: ["german-invoice"] },
	{ q: "in welcher sprache schreibe ich die dokumentation", kind: "crosslingual", relevant: ["german-docs"] },

	// Nothing in the store answers these. Anything injected here is noise.
	{ q: "what is the best pizza topping", kind: "negative", relevant: [] },
	{ q: "explain the plot of a science fiction novel", kind: "negative", relevant: [] },
	{ q: "how tall is the eiffel tower", kind: "negative", relevant: [] },
	{ q: "recommend a good hiking trail nearby", kind: "negative", relevant: [] },
	{ q: "wie wird das wetter morgen", kind: "negative", relevant: [] },
]
