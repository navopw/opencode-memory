# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Requirements

- macOS or Linux
- Bun 1.3.0 or newer
- OpenCode 1.18.x for integration testing

## Development

```sh
git clone https://github.com/navopw/opencode-memory.git
cd opencode-memory
bun install --frozen-lockfile
bun run check
bun audit
```

Run `bun run smoke` after changing embeddings, scoring, retrieval, or model
profiles. It downloads the real default model. Run `bun run bench` when changing
model defaults or thresholds.

## Pull Requests

- Keep changes focused and include tests for behavior changes.
- Update the README and changelog when user-facing behavior changes.
- Ensure `bun run check` and `bun audit` pass.
- Do not commit memory stores, model artifacts, credentials, or
  `.opencode/memory-id`.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
