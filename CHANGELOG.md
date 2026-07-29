# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.4.0 - 2026-07-29

### Added

- Published to npm as `@navopw/opencode-memory`, installable through the
  OpenCode `plugin` config array without a source checkout.
- A build that compiles `src/` to ESM plus type declarations in `dist/`, a
  packaging job in CI, and a script that loads the build through the entry
  point OpenCode resolves.
- A tag-triggered release workflow that publishes with npm trusted publishing
  and provenance attestations.
- macOS and Linux CI, security reporting guidance, contribution documentation,
  and assertions for the real-model smoke script.

### Changed

- Relaxed the `@opencode-ai/plugin` and `@opencode-ai/sdk` dependencies from
  exact pins to compatible ranges, so an installed plugin can match a newer
  OpenCode.
- Updated all direct dependencies and pinned patched transitive ZIP and image
  processing dependencies.
- Rewrote installation, updates, and removal around the npm package, and kept
  the source checkout as the development path.
- Clarified project identity, model downloads, and the memory trust model.
- Strengthened lock ownership and memory prompt boundaries.

### Security

- Lock files now carry process and token ownership, preventing stale-lock
  recovery or release from deleting a live replacement lock.
- Memory prompts explicitly reject commands and authorization originating from
  stored memory text.

## 0.3.0 - 2026-07-28

### Added

- Multilingual local embeddings with benchmarked model profiles.
- Semantic and keyword retrieval benchmark and real-model smoke script.
- Global and project-scoped persistent memory tools.

### Changed

- Made multilingual MiniLM the default embedding model.
- Split the plugin into storage, retrieval, prompt, hook, and tool modules.
