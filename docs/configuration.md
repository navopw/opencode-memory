# Configuration

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
| `embedderIdleMs` | `1800000` | Idle time after which the embedder process exits and releases the model. |

`OPENCODE_MEMORY_DIR`, `OPENCODE_MEMORY_MODEL`, and
`OPENCODE_MEMORY_QUERY_PREFIX` still work and are overridden by plugin options.

`OPENCODE_MEMORY_RUNTIME` overrides the interpreter used to start the embedder
process. It is only needed if the automatic choice fails; see
[Architecture](architecture.md#the-embedder-process).

## Choosing a model

Pooling, prefixes, and the injection threshold are properties of the model, not
of this plugin, so they are stored together per model and applied when
`embeddingModel` is set. Getting any of them wrong degrades retrieval quietly
rather than failing: the wrong pooling still produces valid-looking vectors, and
a threshold borrowed from another model is meaningless, because each model's
similarity scores sit on a different scale.

| Model | Languages | Threshold | Notes |
| --- | --- | --- | --- |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 50+ | `0.59` | Default. Best cross-lingual recall with strong overall ranking and a wide similarity gap. |
| `Xenova/bge-small-en-v1.5` | English | `0.77` | Strong English paraphrase recall, weak on other languages. |
| `Xenova/multilingual-e5-small` | 100 | `0.91` | Multilingual, but relevant and irrelevant scores sit close together, so the threshold is fragile. |
| `Xenova/all-MiniLM-L6-v2` | English | `0.53` | Smallest and fastest, with the best English paraphrase recall. |

Any other model falls back to a family guess and may need `injectThreshold`
tuned by hand; add it to `bench/run.ts` to measure the right value.

Changing the model, pooling, or document prefix invalidates stored vectors.
Nothing is lost: affected memories stay searchable by keyword and are re-embedded
in the background over the following turns.
