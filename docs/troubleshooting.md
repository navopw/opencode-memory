# Troubleshooting

- **Memory tools are missing:** confirm the `plugin` entry names
  `@navopw/opencode-memory` (or that the source path or symlink target exists),
  use only one installation method, then quit and restart OpenCode.
- **A plugin install fails on startup:** OpenCode installs npm plugins with Bun
  into `~/.cache/opencode/node_modules/`. Delete that directory and restart to
  force a clean re-resolve. The package is macOS and Linux only.
- **Two sets of memory tools appear:** the plugin is registered twice, usually
  by an npm entry plus a leftover symlink in `~/.config/opencode/plugins/`.
  Remove one.
- **A tool reports keyword-only search:** the model is still downloading or a
  previous model load failed. Check the OpenCode log and retry after the
  configured `embedderRetryMs` interval.
- **A memory store is busy:** quit other OpenCode processes using the store and
  retry. Stale locks recover automatically. Remove `<store>.lock` or
  `<store>.lock.recovery` only when no OpenCode process is running.
- **A store is damaged:** whole-file errors are never overwritten. Restore the
  JSON file manually; partial-record recovery keeps the original as
  `<store>.corrupt` before the next write.
