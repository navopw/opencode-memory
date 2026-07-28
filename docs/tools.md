# Tools

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `memory_save` | `content` (required, 1-8000 characters)<br>`type` (`preference`, `fact`, `decision`, or `todo`; default: `fact`)<br>`tags` (up to 50 tags, each 1-50 characters)<br>`pinned` (default: `false`)<br>`scope` (`global` or `project`; default: `project`)<br>`force` (default: `false`) | Save a durable memory. Identical content is updated in place. Near-duplicate content is refused unless `force` is set. |
| `memory_recall` | `query` (required)<br>`limit` (1-100; default: `5`)<br>`type` (optional type filter)<br>`tag` (optional tag filter)<br>`scope` (`all`, `global`, or `project`; default: `all`) | Search memories using local semantic similarity and keyword matching. Returns IDs, scopes, types, scores, and tags. |
| `memory_list` | `type` (optional type filter)<br>`tag` (optional tag filter)<br>`scope` (`all`, `global`, or `project`; default: `all`)<br>`limit` (1-100; default: `50`) | List saved memories, ordered by most recently updated. |
| `memory_update` | `id` (required)<br>`content` (optional, 1-8000 characters)<br>`type` (optional)<br>`tags` (optional; replaces all tags)<br>`pinned` (optional) | Update a memory by ID. Changed content is re-embedded automatically. |
| `memory_forget` | `id` (required) | Permanently delete a memory by ID. |
