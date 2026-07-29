# Security Policy

## Supported Versions

Security fixes are applied to the latest version on the `main` branch, released
to npm as [`@navopw/opencode-memory`](https://www.npmjs.com/package/@navopw/opencode-memory).
Supported platforms and the required OpenCode version are documented in the
[README](README.md#install), so they are recorded in one place.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting:

https://github.com/navopw/opencode-memory/security/advisories/new

Include the affected version or commit, reproduction steps, impact, and any
suggested mitigation. You should receive an initial response within seven days.

## Known Transitive Advisories

The repository pins patched versions of `adm-zip` and `sharp` through
`overrides`, but npm and Bun apply overrides only to the root project. An
OpenCode user installing `@navopw/opencode-memory` from npm therefore resolves
the versions that `@huggingface/transformers` and `onnxruntime-node` request, so
`bun audit` in that install reports two high advisories:

- `adm-zip <0.6.0` ([GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85)),
  required as `^0.5.16` by `onnxruntime-node`.
- `sharp <0.35.0` ([GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)),
  required as `^0.34.5` by `@huggingface/transformers`.

Neither range can currently be satisfied by upgrading. Checked 2026-07-29:
`@huggingface/transformers` 4.2.0, the latest release, still requires
`sharp ^0.34.5`, and every `onnxruntime-node` release through 1.27.0 still
requires `adm-zip ^0.5.16`.

Neither package is reachable from this plugin's code paths. `adm-zip` is used
only by the `onnxruntime-node` install script that downloads optional CUDA
binaries, which OpenCode does not run, and `sharp` is used only for image
inputs, which a text-only embedding plugin never passes.

Re-check both when `@huggingface/transformers` publishes past 4.2.0, and drop
the `overrides` pins once upstream ranges allow the patched versions.

## Data and Trust Model

- Embeddings run locally, but recalled memory text is sent to the configured
  model provider as prompt context.
- Memory files can contain sensitive user data. They are stored with owner-only
  permissions under `~/.config/opencode/memory/` by default.
- Memory text is untrusted data, not authorization. Language-model instructions
  reduce prompt-injection risk but cannot create a hard security boundary.
- Do not store credentials or content that must not reach the configured model
  provider.
