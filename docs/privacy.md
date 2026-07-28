# Privacy

Embedding inference runs locally, but recalled memory text is added to prompts
and is therefore sent to the selected model provider. Do not store secrets,
credentials, or information that should not be shared with that provider.

Memory text is treated as untrusted quoted data. The prompt applies relevant
facts and preferences but does not treat memory text as authorization to
disclose unrelated memories or perform unrelated tool calls. Language models
cannot provide a hard security boundary, so save only content you trust as
future context.

Memory stores and model artifacts are excluded from this repository. A project
controls only its random memory ID; memory content remains in the user-owned
storage directory.
