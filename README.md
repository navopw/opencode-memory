# opencode-memory

Persistent semantic memory for [OpenCode](https://opencode.ai/).

The plugin gives OpenCode five tools for saving, recalling, listing, updating,
and deleting durable memories. It combines local multilingual embeddings with
keyword matching, injects relevant memories into later conversations, and keeps
global and project-scoped memories separate.

## Status

This repository is under active development. It targets OpenCode `1.18.x` and
uses an experimental system prompt hook.

## Features

- Local multilingual embeddings through Transformers.js and ONNX, no data leaves
  the machine to build them; a German question finds an English memory
- Global memories shared across projects, project memories keyed by a stable
  `.opencode/memory-id` marker and stored outside the repository
- Keyword retrieval whenever a vector is unavailable, so memories are never
  silently unreachable
- Retrieval never blocks a turn on the model load
- Configurable from `opencode.jsonc` without touching the source
- Atomic, fsynced writes with restrictive permissions and cross-process locking
- Damaged records are skipped and reported rather than disabling the plugin
- Near-duplicate memories are refused instead of quietly accumulating

## Install

Supports macOS and Linux. Requires [Bun](https://bun.sh/) `1.3.0` or newer and
OpenCode `1.18.x`.

```sh
git clone https://github.com/navopw/opencode-memory.git
cd opencode-memory
bun install --frozen-lockfile
mkdir -p ~/.config/opencode/plugins
ln -s "$PWD/src/index.ts" ~/.config/opencode/plugins/memory.ts
```

OpenCode automatically loads TypeScript files in `~/.config/opencode/plugins/`.
Quit and restart OpenCode after installing the plugin. The first startup
downloads the default embedding model from Hugging Face and caches it locally,
so it can take several minutes and use several hundred megabytes of disk space.
Memory text is not sent to Hugging Face.

Verify the installation by opening OpenCode and asking it to list its memory
tools. `memory_save`, `memory_recall`, `memory_list`, `memory_update`, and
`memory_forget` should be available.

To pass configuration, reference the plugin from `opencode.jsonc` instead of
symlinking it:

```jsonc
{
	"$schema": "https://opencode.ai/config.json",
	"plugin": [["/absolute/path/to/opencode-memory/src/index.ts", { "topK": 8 }]]
}
```

Use only one installation method. Loading both the symlink and the config entry
registers the plugin twice. This project is distributed from source and is not
published to npm.

### Update

Quit every running OpenCode process before updating so no older plugin instance
can write while storage migrations run.

```sh
cd /path/to/opencode-memory
git pull --ff-only
bun install --frozen-lockfile
```

Restart OpenCode after updating.

### Remove

For a symlink installation:

```sh
rm ~/.config/opencode/plugins/memory.ts
```

For a config installation, remove the plugin entry from `opencode.jsonc`.
Removing the plugin does not delete memory data. Delete
`~/.config/opencode/memory/` separately only if you intend to erase every saved
memory.

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
bun audit
```

`bun run smoke` downloads and exercises the real default model. Run it after
changing embedding, scoring, or model-profile behavior. `bun run bench` runs the
full labelled retrieval benchmark.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow,
[SECURITY.md](SECURITY.md) for private vulnerability reporting, and
[CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE)
