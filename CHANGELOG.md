# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- Quitting OpenCode with Ctrl+C no longer crashes it with
  `panic: NAPI FATAL ERROR: Error::New napi_create_error`. The embedding model
  was loaded in-process, which pulled the `onnxruntime-node` NAPI addon into
  OpenCode; Bun then panicked while tearing the addon down on exit. The model
  now runs in a separate process, so no native addon is loaded into OpenCode.

### Changed

- The embedder runs as its own detached process and speaks newline-delimited
  JSON over stdio. It exits when OpenCode does, and after `embedderIdleMs`
  without a request. This also moves roughly 2 GB of resident memory out of
  OpenCode.

### Added

- `embedderIdleMs` (default 30 minutes) controls how long the embedder process
  stays resident while idle.
- `OPENCODE_MEMORY_RUNTIME` overrides the interpreter used to start the embedder
  process, for environments where the automatic choice does not work.

## 0.4.3 - 2026-07-29

### Added

- Documented platform support in the README: Windows is excluded through the
  package `os` field, Intel Macs fall back to keyword-only search because the
  pinned ONNX runtime no longer ships a darwin x64 binary, and all inference
  runs on CPU.

## 0.4.2 - 2026-07-29

### Changed

- Documented the required OpenCode version once, under Install, and pointed the
  contributing and security documents at it. The prose said `1.18.x` while the
  package depends on `^1.18.9`, which disagreed about whether a later minor is
  supported.
- Recorded the date and the exact upstream versions checked for the known
  transitive `adm-zip` and `sharp` advisories, so the claim that no fixed
  release exists can be re-verified.

## 0.4.1 - 2026-07-29

### Changed

- Documented installation through npm only, dropping the source checkout and
  symlink methods, and removed the status section from the README. The 0.4.0
  package was published before these edits, so its npm page still described
  installing from source.

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
