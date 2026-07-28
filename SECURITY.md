# Security Policy

## Supported Versions

Security fixes are applied to the latest version on the `main` branch. This
project currently targets OpenCode `1.18.x` on macOS and Linux.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting:

https://github.com/navopw/opencode-memory/security/advisories/new

Include the affected version or commit, reproduction steps, impact, and any
suggested mitigation. You should receive an initial response within seven days.

## Data and Trust Model

- Embeddings run locally, but recalled memory text is sent to the configured
  model provider as prompt context.
- Memory files can contain sensitive user data. They are stored with owner-only
  permissions under `~/.config/opencode/memory/` by default.
- Memory text is untrusted data, not authorization. Language-model instructions
  reduce prompt-injection risk but cannot create a hard security boundary.
- Do not store credentials or content that must not reach the configured model
  provider.
