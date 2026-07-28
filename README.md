# opencode-memory

Persistent semantic memory for [OpenCode](https://opencode.ai/).

The plugin gives OpenCode five tools for saving, recalling, listing, updating,
and deleting durable memories. It combines local BGE embeddings with keyword
matching, injects relevant memories into later conversations, and keeps global
and project-scoped memories separate.

## Status

This repository is under active development. It currently targets OpenCode
`1.18.7` and uses an experimental system prompt hook.

## Features

- Local embeddings through Transformers.js and ONNX
- Global memories shared across projects
- Project memories stored outside repositories and keyed by canonical path
- Keyword fallback when the embedding model is unavailable
- Atomic writes, restrictive file permissions, schema validation, and store locks
- Exact duplicate handling without semantic overwrites across scopes
- Automatic reminders when a user asks OpenCode to remember something

## Install From Source

Requires [Bun](https://bun.sh/) and OpenCode.

```sh
git clone https://github.com/navopw/opencode-memory.git
cd opencode-memory
bun install
ln -s "$PWD/src/index.ts" ~/.config/opencode/plugins/memory.ts
```

OpenCode automatically loads TypeScript files in
`~/.config/opencode/plugins/`. Quit and restart OpenCode after installing or
updating the plugin.

## Tools

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `memory_save` | `content` (required, 1-8000 characters)<br>`type` (`preference`, `fact`, `decision`, or `todo`; default: `fact`)<br>`tags` (up to 50 tags)<br>`pinned` (default: `false`)<br>`scope` (`global` or `project`; default: `project`) | Save a durable memory. An exact content duplicate in the same scope is updated instead of creating another record. |
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
                              | Warm local BGE model  |
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
                              | 1. Embed query locally|    |
                              | 2. Score both stores  |    |
                              | 3. Diversify matches  |    |
                              | 4. Select up to 5     |----+
                              +-----------+-----------+
                                          |
                              Embeddings unavailable?
                                          |
                                          v
                              +-----------------------+
                              | Use keyword matching  |
                              +-----------------------+

+-----------------------+     +-----------------------+
| "Remember ..." text   |---->| Add synthetic reminder|
+-----------------------+     | to consider calling   |
                              | memory_save           |
                              +-----------------------+

+-----------------------+     +-----------------------+
| Memory tool call      |---->| Lock store            |
| save/update/forget    |     | and atomically write  |
+-----------------------+     +-----------------------+
```

The system prompt hook adds a compact, stable index of pinned and recent
memories. This gives the model standing preferences and a small overview
without searching the complete store on every turn.

The message hook separately searches both scopes for the current user message.
It injects matching, unpinned memories as a synthetic text part inside a
`<memory-context>` block. Entries are JSON-quoted and explicitly marked as user
data, not instructions. A memory is not injected into the same session again
for eight turns.

When a message contains phrases such as "remember" or "do not forget", the
plugin also adds a synthetic reminder that asks the model to consider using
`memory_save`. The model still decides whether the information is durable
enough to save.

Global memories are stored in
`~/.config/opencode/memory/memories.json`. Project memories are stored in
`~/.config/opencode/memory/projects/`, keyed by a hash of the canonical
worktree path. Set `OPENCODE_MEMORY_DIR` to change the storage root.

The default embedding model is `Xenova/bge-small-en-v1.5`. Set
`OPENCODE_MEMORY_MODEL` to override it. Existing vectors are ignored and
rebuilt when the configured model changes.

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

## License

[MIT](LICENSE)
