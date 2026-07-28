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

| Tool | Purpose |
| --- | --- |
| `memory_save` | Save a preference, fact, decision, or todo |
| `memory_recall` | Search memories by meaning and keywords |
| `memory_list` | List memories with optional filters |
| `memory_update` | Update a memory by ID |
| `memory_forget` | Delete a memory by ID |

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
