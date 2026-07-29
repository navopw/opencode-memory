# Architecture

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
| projects/<id>.json    |     +-----------------------+    |
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
                               | 1. Embed query if the |
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
memories are stored in `~/.config/opencode/memory/projects/`, keyed by the UUID
in the worktree's local `.opencode/memory-id` marker. Keep this marker untracked
by adding `.opencode/memory-id` to the project's `.gitignore`. It moves when the
local folder is renamed or moved, but a fresh clone gets its own project memory
store. Memory content remains outside the project. Existing canonical-path
stores are migrated automatically on first access. New markers are created
lazily when the first project memory is saved. If the worktree cannot be
written, the plugin falls back to the canonical-path key.

Writes take a lock file, are fsynced, and are renamed into place, so a crash or
a second OpenCode window cannot interleave two updates.

If individual records fail validation they are skipped rather than failing the
whole store, the original file is copied to `<store>.corrupt` before the next
write, and `memory_recall` and `memory_list` report how many were dropped.
Problems affecting the whole file, such as invalid JSON or an unknown schema
version, still raise an error and are never overwritten.

## The embedder process

The model never loads inside OpenCode. `embedder-worker.ts` runs as its own
process and answers embedding requests over newline-delimited JSON on stdio.

This is not about isolation for its own sake. The model runs through
`onnxruntime-node`, a NAPI addon, and loading a NAPI addon into OpenCode makes
Ctrl+C crash the editor: Bun tears down the JS VM while the addon still holds
native state, the addon then creates a JS error through a dead `napi_env`, and
Bun panics with `NAPI FATAL ERROR: Error::New napi_create_error`. The panic is a
Bun teardown bug ([oven-sh/bun#24054](https://github.com/oven-sh/bun/issues/24054)),
but OpenCode ships its own bundled Bun, so a plugin cannot wait for a fix. Not
loading the addon is the part a plugin controls. Keeping it out also moves
roughly 2 GB of resident memory out of the editor.

The worker is spawned detached, in its own process group, so the terminal's
Ctrl+C never reaches it. It leaves when its stdin closes, which happens as soon
as OpenCode exits for any reason, and also after `embedderIdleMs` without a
request so an idle editor does not hold a model resident. Both exits go through
`SIGKILL` deliberately: a graceful exit would unwind ONNX through NAPI, which is
the crash being avoided.

Choosing an interpreter takes one wrinkle. OpenCode is a Bun standalone
executable, so `process.execPath` re-runs OpenCode rather than a script; the
worker is therefore launched through that same binary with `BUN_BE_BUN=1`, which
makes a standalone Bun executable behave as the bun CLI. A plain `bun` on
`execPath` is used directly. `OPENCODE_MEMORY_RUNTIME` overrides both.

If the worker cannot start, the failure is logged and retrieval falls back to
keyword matching, the same degradation as a failed model download.

## Source Layout

```text
src/
  index.ts        plugin entry, the only file OpenCode imports
  config.ts       defaults, bounds, and option resolution
  context.ts      the context handed to hooks and tools
  types.ts        Memory and store types
  store.ts        paths, validation, locking, atomic writes
  embedding.ts    model lifecycle and the two embed paths
  embedder-client.ts  spawns the embedder process and speaks its protocol
  embedder-worker.ts  the embedder process itself, never imported by the plugin
  scoring.ts      tokenizing, cosine, scoring, relevance, diversification
  memories.ts     cross-store queries and embedding backfill
  prompt.ts       the cached system prompt block
  hooks.ts        system prompt and message hooks
  tools/          tool implementations, registry, and shared schemas
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
