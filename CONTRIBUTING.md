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

## Releasing

The package is published to npm as
[`@navopw/opencode-memory`](https://www.npmjs.com/package/@navopw/opencode-memory).
Releases are cut by pushing a tag; `.github/workflows/release.yml` builds,
checks, and publishes with npm trusted publishing, so no npm token is stored in
the repository.

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. Merge that to `main`.
3. Tag the release and push the tag. The workflow refuses to publish when the
   tag and `package.json` version disagree.

```sh
git tag v0.4.0
git push origin v0.4.0
```

`bun run build` compiles `src/` to `dist/` with `tsconfig.build.json`, rewriting
the `.ts` import specifiers to `.js`. Only `dist/` and `src/` are published.
`bun run scripts/verify-package.ts` loads the build the way OpenCode resolves an
npm plugin: through `exports["./server"]`, falling back to `main`. OpenCode
never reads `exports["."]`, so that entry exists for tooling only.

## Dependencies

Dependabot opens weekly pull requests for npm packages and GitHub Actions.
Minor and patch bumps are grouped into a single PR per ecosystem and merge
themselves once CI is green; major bumps get their own PR and are reviewed by
hand.

Report security issues privately as described in [SECURITY.md](SECURITY.md).
