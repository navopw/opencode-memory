# Troubleshooting

- **Memory tools are missing:** confirm the `plugin` entry names
  `@navopw/opencode-memory`, then quit and restart OpenCode.
- **A plugin install fails on startup:** OpenCode installs npm plugins with Bun
  into `~/.cache/opencode/node_modules/`. Delete that directory and restart to
  force a clean re-resolve. The package is macOS and Linux only.
- **Two sets of memory tools appear:** the plugin is registered twice, usually
  by duplicate entries across `~/.config/opencode/opencode.json` and a project
  `opencode.json`. Remove one.
- **A tool reports keyword-only search:** the model is still downloading, or the
  embedder process failed to start. Check the OpenCode log and retry after the
  configured `embedderRetryMs` interval. If the log says the embedder could not
  be started, set `OPENCODE_MEMORY_RUNTIME` to a `bun` binary.
- **OpenCode crashes on Ctrl+C with `NAPI FATAL ERROR`:** older versions loaded
  the embedding model inside OpenCode, which made Bun panic while tearing down
  the ONNX NAPI addon. Upgrade. The model now runs in its own process, so no
  native addon is loaded into OpenCode.
- **A leftover embedder process:** it exits with OpenCode and after
  `embedderIdleMs` idle. One embedder per running OpenCode is expected, and it
  holds the model, so it is the large one.
- **A memory store is busy:** quit other OpenCode processes using the store and
  retry. Stale locks recover automatically. Remove `<store>.lock` or
  `<store>.lock.recovery` only when no OpenCode process is running.
- **A store is damaged:** whole-file errors are never overwritten. Restore the
  JSON file manually; partial-record recovery keeps the original as
  `<store>.corrupt` before the next write.
