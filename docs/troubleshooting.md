# Troubleshooting

- **Memory tools are missing:** confirm that the symlink target exists, use only
  one installation method, then quit and restart OpenCode.
- **A tool reports keyword-only search:** the model is still downloading or a
  previous model load failed. Check the OpenCode log and retry after the
  configured `embedderRetryMs` interval.
- **A memory store is busy:** quit other OpenCode processes using the store and
  retry. Stale locks recover automatically. Remove `<store>.lock` or
  `<store>.lock.recovery` only when no OpenCode process is running.
- **A store is damaged:** whole-file errors are never overwritten. Restore the
  JSON file manually; partial-record recovery keeps the original as
  `<store>.corrupt` before the next write.
