# opencode-memory

[![npm](https://img.shields.io/npm/v/@navopw/opencode-memory)](https://www.npmjs.com/package/@navopw/opencode-memory)
[![CI](https://github.com/navopw/opencode-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/navopw/opencode-memory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Persistent semantic memory for [OpenCode](https://opencode.ai/).

The plugin gives OpenCode five tools for saving, recalling, listing, updating,
and deleting durable memories. It combines local multilingual embeddings with
keyword matching, injects relevant memories into later conversations, and keeps
global and project-scoped memories separate.

<img width="901" height="609" alt="image" src="https://github.com/user-attachments/assets/25aef0cb-9819-4142-b57b-ed18f860b66a" />

## Features

- Local multilingual embeddings through Transformers.js and ONNX, no data leaves
  the machine to build them; a German question finds an English memory
- Global memories shared across projects, project memories keyed by a stable
  `.opencode/memory-id` marker and stored outside the repository
- Keyword retrieval whenever a vector is unavailable, so memories are never
  silently unreachable
- Retrieval never blocks a turn on the model load
- The model runs in its own process, keeping its memory and its native ONNX
  runtime out of OpenCode
- Configurable from `opencode.jsonc` without touching the source
- Atomic, fsynced writes with restrictive permissions and cross-process locking
- Damaged records are skipped and reported rather than disabling the plugin
- Near-duplicate memories are refused instead of quietly accumulating

## Install

Supports macOS and Linux. Requires [Bun](https://bun.sh/) `1.3.0` or newer and
OpenCode `1.18.9` or newer. The plugin uses an experimental system prompt hook,
so a later OpenCode release can change or remove it.

Add the package to the `plugin` array in your OpenCode config, either
`~/.config/opencode/opencode.json` for every project or `opencode.json` in a
single repository:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugin": ["@navopw/opencode-memory"]
}
```

To change [configuration](docs/configuration.md), use the
`[package, options]` form instead:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugin": [["@navopw/opencode-memory", { "topK": 8 }]]
}
```

OpenCode installs the package with Bun on startup and caches it under
`~/.cache/opencode/node_modules/`. Quit and restart OpenCode after editing the
config. The first startup also downloads the default embedding model from
Hugging Face and caches it locally, so it can take several minutes and use
several hundred megabytes of disk space. Memory text is not sent to Hugging
Face.

Verify the installation by opening OpenCode and asking it to list its memory
tools. `memory_save`, `memory_recall`, `memory_list`, `memory_update`, and
`memory_forget` should be available.

Pin a version if you would rather approve updates yourself:

```jsonc
{
	"plugin": ["@navopw/opencode-memory@0.4.0"]
}
```

### Update

Quit every running OpenCode process before updating so no older plugin instance
can write while storage migrations run.

An unpinned npm install picks up the newest release on the next OpenCode
startup. Clear the cache to force a re-resolve:

```sh
rm -rf ~/.cache/opencode/node_modules
```

Restart OpenCode after updating.

### Remove

Remove the plugin entry from your OpenCode config.

Removing the plugin does not delete memory data. Delete
`~/.config/opencode/memory/` separately only if you intend to erase every saved
memory.

## Platform support

| Platform | Status |
| --- | --- |
| macOS (Apple Silicon) | Fully supported, tested in CI |
| macOS (Intel) | Installs, but falls back to keyword-only search |
| Linux (x64, arm64) | Supported; CI tests x64 |
| Windows | Not supported |

Windows is deliberately excluded via the `os` field in `package.json`. On Intel
Macs the pinned ONNX runtime no longer ships a darwin x64 binary, so embeddings
never load and only keyword search remains. All inference runs on CPU; no GPU
is required.

## Documentation

- [Configuration](docs/configuration.md) - all options and choosing a model
- [Tools](docs/tools.md) - the five memory tools and their parameters
- [Architecture](docs/architecture.md) - context injection, retrieval, and storage
- [Benchmark](docs/benchmark.md) - retrieval quality across models
- [Privacy](docs/privacy.md) - data and trust model
- [Troubleshooting](docs/troubleshooting.md) - common problems

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun audit
```

`bun run smoke` downloads and exercises the real default model. Run it after
changing embedding, scoring, or model-profile behavior. `bun run bench` runs the
full labelled retrieval benchmark. `bun run build` compiles the published
`dist/`, and `bun run scripts/verify-package.ts` loads it the way OpenCode
loads an npm plugin.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow,
[SECURITY.md](SECURITY.md) for private vulnerability reporting, and
[CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE)
