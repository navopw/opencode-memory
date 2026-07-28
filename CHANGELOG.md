# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- macOS and Linux CI, security reporting guidance, contribution documentation,
  and assertions for the real-model smoke script.

### Changed

- Updated all direct dependencies and pinned patched transitive ZIP and image
  processing dependencies.
- Clarified source installation, updates, removal, project identity, model
  downloads, and the memory trust model.
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
