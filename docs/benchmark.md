# Benchmark

`bun run bench` scores the real retrieval code against a labelled corpus of 107
memories and 268 queries in `bench/dataset.ts`, covering English and German
paraphrases, literal keyword matches, cross-lingual retrieval, and nonsense
queries that should return nothing.

```
model                                  recall@5 MRR@5  para  lex   xling best t F1    noise
keyword only (no model)                  75%      65%    75%  100%   51% 0.06     58%    5%
bge-small-en-v1.5                        82%      74%    91%  100%   53% 0.77     63%    0%
multilingual-e5-small                    87%      79%    88%  100%   75% 0.91     61%    0%
multilingual-e5-small [WRONG cls pooling]  83%      75%    82%  100%   70% 0.98     61%    5%
paraphrase-multilingual-MiniLM-L12       87%      80%    84%  100%   79% 0.59     64%    0%
all-MiniLM-L6-v2 (english only)          81%      74%    93%  100%   47% 0.53     64%    0%
```

`noise` is the share of nonsense queries that would still inject something.
`best t` is the threshold maximising F1, which is where each model's default
`injectThreshold` comes from.

Three things this measures that are easy to get wrong:

- **Keyword fallback is much worse than embeddings**, 75% against 87% recall. It
  is a safety net for a cold or broken model, not an equivalent path.
- **Pooling matters.** The same model with CLS instead of mean pooling loses 4
  points of recall and 6 points on paraphrases, while still producing vectors
  that look perfectly normal.
- **Thresholds do not transfer.** Relevant and irrelevant pairs average 0.79 and
  0.49 under bge-small, but 0.93 and 0.77 under multilingual-e5. A single global
  default cannot serve both.

`bun run smoke` is a faster end-to-end check against the real default model,
useful after changing the model or its profile.
