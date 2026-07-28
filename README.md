# opencode-memory

Persistent semantic memory for [OpenCode](https://opencode.ai/).

The plugin gives OpenCode five tools for saving, recalling, listing, updating,
and deleting durable memories. It combines local BGE embeddings with keyword
matching, injects relevant memories into later conversations, and keeps global
and project-scoped memories separate.

## Status

This repository is under active development. It targets OpenCode `1.18.x` and
uses an experimental system prompt hook.

## Features

- Local multilingual embeddings through Transformers.js and ONNX, no data leaves
  the machine to build them; a German question finds an English memory
- Global memories shared across projects, project memories keyed by canonical
  worktree path and stored outside the repository
- Keyword retrieval whenever a vector is unavailable, so memories are never
  silently unreachable
- Retrieval never blocks a turn on the model load
- Configurable from `opencode.jsonc` without touching the source
- Atomic, fsynced writes with restrictive permissions and cross-process locking
- Damaged records are skipped and reported rather than disabling the plugin
- Near-duplicate memories are refused instead of quietly accumulating

## Install

Requires [Bun](https://bun.sh/) and OpenCode.

```sh
git clone https://github.com/navopw/opencode-memory.git
cd opencode-memory
bun install
ln -s "$PWD/src/index.ts" ~/.config/opencode/plugins/memory.ts
```

OpenCode automatically loads TypeScript files in `~/.config/opencode/plugins/`.
Quit and restart OpenCode after installing or updating the plugin.

To pass configuration, reference the plugin from `opencode.jsonc` instead of
symlinking it:

```jsonc
{
  "plugin": [["/absolute/path/to/opencode-memory/src/index.ts", { "topK": 8 }]]
}
```

## Configuration

Every option below can be set in the `opencode.jsonc` plugin entry. Unknown or
out-of-range values are reported in the OpenCode log and ignored or clamped,
never fatal.

| Option | Default | Purpose |
| --- | --- | --- |
| `dir` | `~/.config/opencode/memory` | Storage root for both stores. |
| `embeddingModel` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Local embedding model. Setting this also sets `pooling`, both prefixes, and `injectThreshold` to that model's measured profile. |
| `pooling` | from the model profile | `cls` or `mean`. Must match how the model was trained. |
| `queryPrefix` / `documentPrefix` | from the model profile | Prepended before embedding. Asymmetric models such as e5 need both. |
| `topK` | `5` | Max memories injected per user message. |
| `injectThreshold` | from the model profile | Minimum similarity for automatic injection. The main relevance dial, and **model-specific** — see below. |
| `keywordMinHits` | `2` | Keyword matches required when a memory has no comparable vector. |
| `nearDupeThreshold` | `0.95` | Retrieval hits this similar to a selected hit are skipped. |
| `duplicateThreshold` | `0.92` | `memory_save` refuses content this similar to an existing memory. |
| `maxPinned` | `10` | Pinned entries in the system prompt. |
| `maxIndexLines` | `30` | Recent entries in the system prompt. |
| `indexMaxAgeDays` | `90` | Age cutoff for the recent index. |
| `hookTimeoutMs` | `3000` | Inference budget inside hooks. |
| `toolTimeoutMs` | `15000` | Inference budget inside tool calls. |
| `modelLoadTimeoutMs` | `180000` | How long a tool call may wait for the model to download on first use. |
| `reinjectAfterTurns` | `8` | Turns before the same memory may be injected again. |
| `backfillBatch` | `10` | Memories re-embedded per backfill pass. |
| `maxStoreBytes` | `10485760` | Refuse to read a store larger than this. |
| `lockStaleMs` | `30000` | Age at which a lock file is treated as abandoned. |
| `lockRetries` / `lockRetryMs` | `5` / `40` | Retry policy when another process holds the lock. |
| `embedderRetryMs` | `300000` | Wait before retrying a failed model load. |

`OPENCODE_MEMORY_DIR`, `OPENCODE_MEMORY_MODEL`, and
`OPENCODE_MEMORY_QUERY_PREFIX` still work and are overridden by plugin options.

### Choosing a model

Pooling, prefixes, and the injection threshold are properties of the model, not
of this plugin, so they are stored together per model and applied when
`embeddingModel` is set. Getting any of them wrong degrades retrieval quietly
rather than failing: the wrong pooling still produces valid-looking vectors, and
a threshold borrowed from another model is meaningless, because each model's
similarity scores sit on a different scale.

| Model | Languages | Threshold | Notes |
| --- | --- | --- | --- |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 50+ | `0.51` | Default. Best cross-lingual retrieval and the widest margin between relevant and irrelevant. |
| `Xenova/bge-small-en-v1.5` | English | `0.69` | Previous default. Slightly better ranking on English, weak on other languages. |
| `Xenova/multilingual-e5-small` | 94 | `0.88` | Multilingual, but relevant and irrelevant scores sit close together, so the threshold is fragile. |
| `Xenova/all-MiniLM-L6-v2` | English | `0.42` | Smallest and fastest. |

Any other model falls back to a family guess and may need `injectThreshold`
tuned by hand; add it to `bench/run.ts` to measure the right value.

Changing the model, pooling, or document prefix invalidates stored vectors.
Nothing is lost: affected memories stay searchable by keyword and are re-embedded
in the background over the following turns.

## Benchmark

`bun run bench` scores the real retrieval code against a labelled corpus of 30
memories and 36 queries in `bench/dataset.ts`, covering English paraphrases,
literal keyword matches, German questions against English memories, and nonsense
queries that should return nothing.

```
model                                  recall@5 MRR@5  para  lex   xling best t F1    noise
keyword only (no model)                  65%      59%    60%  100%   50% 0.06     45%    0%
bge-small-en-v1.5                        90%      80%    90%  100%   83% 0.69     64%   20%
multilingual-e5-small                    90%      75%    90%  100%   83% 0.88     65%    0%
multilingual-e5-small [WRONG cls pooling]  81%      66%    70%  100%  100% 0.98     58%    0%
paraphrase-multilingual-MiniLM-L12       94%      78%    90%  100%  100% 0.51     64%    0%
all-MiniLM-L6-v2 (english only)          94%      81%    95%  100%   83% 0.42     64%    0%
```

`noise` is the share of nonsense queries that would still inject something.
`best t` is the threshold maximising F1, which is where each model's default
`injectThreshold` comes from.

Three things this measures that are easy to get wrong:

- **Keyword fallback is much worse than embeddings**, 65% against 94% recall. It
  is a safety net for a cold or broken model, not an equivalent path.
- **Pooling matters.** The same model with CLS instead of mean pooling loses 13
  points of recall and 20 points on paraphrases, while still producing vectors
  that look perfectly normal.
- **Thresholds do not transfer.** Relevant and irrelevant pairs average 0.74 and
  0.48 under bge-small, but 0.90 and 0.77 under multilingual-e5. A single global
  default cannot serve both.

`bun run smoke` is a faster end-to-end check against the real default model,
useful after changing the model or its profile.

## Tools

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `memory_save` | `content` (required, 1-8000 characters)<br>`type` (`preference`, `fact`, `decision`, or `todo`; default: `fact`)<br>`tags` (up to 50 tags)<br>`pinned` (default: `false`)<br>`scope` (`global` or `project`; default: `project`)<br>`force` (default: `false`) | Save a durable memory. Identical content is updated in place. Near-duplicate content is refused unless `force` is set. |
| `memory_recall` | `query` (required)<br>`limit` (1-100; default: `5`)<br>`type` (optional type filter)<br>`tag` (optional tag filter)<br>`scope` (`all`, `global`, or `project`; default: `all`) | Search memories using local semantic similarity and keyword matching. Returns IDs, scopes, types, scores, and tags. |
| `memory_list` | `type` (optional type filter)<br>`tag` (optional tag filter)<br>`scope` (`all`, `global`, or `project`; default: `all`)<br>`limit` (1-100; default: `50`) | List saved memories, ordered by most recently updated. |
| `memory_update` | `id` (required)<br>`content` (optional, 1-8000 characters)<br>`type` (optional)<br>`tags` (optional; replaces all tags)<br>`pinned` (optional) | Update a memory by ID. Changed content is re-embedded automatically. |
| `memory_forget` | `id` (required) | Permanently delete a memory by ID. |

## Context Injection

```text
                              +-----------------------+
                              | OpenCode starts       |
                              +-----------+-----------+
                                          |
                                          v
                              +-----------------------+
                              | Warm local embedding  |
                              | in the background     |
                              +-----------------------+

+-----------------------+     +-----------------------+
| Global memory store   |---->| System prompt hook    |
| memories.json         |     |                       |
+-----------------------+     | - Up to 10 pinned     |
                              | - Up to 30 recent     |----+
+-----------------------+     | - Last 90 days        |    |
| Project memory store  |---->|                       |    |
| projects/<hash>.json  |     +-----------------------+    |
+-----------+-----------+                                  |
            |                                              |
            |                                              v
            |                                  +-----------------------+
            |                                  | LLM request           |
            |                                  |                       |
            |                                  | System memory index   |
            |                                  | + user message        |
            |                                  | + relevant memories   |
            |                                  +-----------+-----------+
            |                                              ^
            v                                              |
+-----------------------+     +-----------------------+    |
| New user message      |---->| Message hook          |    |
+-----------------------+     |                       |    |
                              | 1. Embed query if the |    |
                              |    model is resident  |    |
                              | 2. Score both stores  |    |
                              | 3. Diversify matches  |    |
                              | 4. Select up to 5     |----+
                              +-----------+-----------+
                                          |
                              Model not resident, or
                              memory has no vector?
                                          |
                                          v
                              +-----------------------+
                              | Score it on keywords, |
                              | re-embed in the       |
                              | background            |
                              +-----------------------+

+-----------------------+     +-----------------------+
| "Remember ..." text   |---->| Add synthetic reminder|
+-----------------------+     | to consider calling   |
                              | memory_save           |
                              +-----------------------+

+-----------------------+     +-----------------------+
| Memory tool call      |---->| Lock store, fsync,    |
| save/update/forget    |     | rename atomically     |
+-----------------------+     +-----------------------+
```

The system prompt hook adds a compact, stable index of pinned and recent
memories. This gives the model standing preferences and a small overview
without searching the complete store on every turn. The text is cached on store
mtimes so it stays byte-identical between turns and does not invalidate prompt
caching upstream.

The message hook separately searches both scopes for the current user message.
It injects matching, unpinned memories as a synthetic text part inside a
`<memory-context>` block. Entries are JSON-quoted and explicitly marked as user
data, not instructions. A memory is not injected into the same session again
for eight turns; because injected parts stay in the session transcript, this
prevents repeated entries rather than reducing the tokens already sent.

When a message contains phrases such as "remember" or "do not forget", the
plugin also adds a synthetic reminder that asks the model to consider using
`memory_save`. The model still decides whether the information is durable
enough to save.

### Retrieval without a vector

The model is loaded in the background and hooks never wait for it, so the first
messages after a cold start are scored on keywords alone rather than stalling
for the download.

A memory can also lack a usable vector: it was saved during a model outage, or
`embeddingModel` was changed since. Cosine similarity against such a memory is
meaningless, so it is scored on keywords instead of being compared and
discarded. In the background the message hook re-embeds a small batch of these
per turn, so the store heals itself without a manual pass.

## Storage

Global memories are stored in `~/.config/opencode/memory/memories.json`. Project
memories are stored in `~/.config/opencode/memory/projects/`, keyed by a hash of
the canonical worktree path.

Writes take a lock file, are fsynced, and are renamed into place, so a crash or
a second OpenCode window cannot interleave two updates.

If individual records fail validation they are skipped rather than failing the
whole store, the original file is copied to `<store>.corrupt` before the next
write, and `memory_recall` and `memory_list` report how many were dropped.
Problems affecting the whole file, such as invalid JSON or an unknown schema
version, still raise an error and are never overwritten.

## Privacy

Embedding inference runs locally, but recalled memory text is added to prompts
and is therefore sent to the selected model provider. Do not store secrets,
credentials, or information that should not be shared with that provider.

Memory stores and model artifacts are excluded from this repository. Project
memories are not read from repository-controlled files.

## Development

```sh
bun install
bun run check
```

```text
src/
  index.ts        plugin entry, the only file OpenCode imports
  config.ts       defaults, bounds, and option resolution
  context.ts      the context handed to hooks and tools
  types.ts        Memory and store types
  store.ts        paths, validation, locking, atomic writes
  embedding.ts    model lifecycle and the two embed paths
  scoring.ts      tokenizing, cosine, scoring, relevance, diversification
  memories.ts     cross-store queries and embedding backfill
  prompt.ts       the cached system prompt block
  hooks.ts        system prompt and message hooks
  tools/          one file per tool
```

```text
bench/
  dataset.ts      labelled corpus and queries, English and German
  run.ts          scores models against it, sweeps the threshold
  smoke.ts        end-to-end check with the real default model
```

`src/index.ts` default-exports `{ id, server }`. OpenCode reads only the default
export for that shape, so named exports are safe; the older loader, still used
for plain function exports, rejects any export that is not a plugin function.

## License

[MIT](LICENSE)
