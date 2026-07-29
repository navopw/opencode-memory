#!/bin/sh
# Stands in for the bun interpreter that starts the embedder. Ignores the real
# worker path in $1 and runs the fake worker instead, forwarding the options
# JSON in $2, so the client can be tested without loading a model.
exec "$FAKE_EMBEDDER_BUN" "$FAKE_EMBEDDER_WORKER" "$2"
