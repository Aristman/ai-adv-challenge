# Step 1: Pipeline Setup & Initial Results

**Date:** 2026-04-26  
**Branch:** AIACH-007  
**Model:** Ollama `phi4:14b` (localhost:11434)

## Test Dataset

- **File:** `data/ner-testset.jsonl`
- **Total examples:** 45
  - 15 `correct` — straightforward NER cases
  - 15 `boundary` — edge cases (ambiguous entities, informal formats)
  - 15 `hard` — complex multi-entity, nested, or adversarial examples

## Pipeline Configuration

- **Approach:** Self-check extraction + verification → constraint validation → confidence assessment
- **Inter-request delay:** 500ms
- **All 45 examples processed successfully** (no errors, no retries)

## Key Results

### Overall Metrics

| Metric | Value |
|--------|-------|
| Avg Precision | 0.8056 |
| Avg Recall | 0.7808 |
| Avg F1 | 0.7905 |

### Precision by Category

| Category | Precision |
|----------|-----------|
| correct | 0.9223 |
| boundary | 0.7333 |
| hard | 0.7611 |

### Recall by Category

| Category | Recall |
|----------|--------|
| correct | 0.9223 |
| boundary | 0.7000 |
| hard | 0.7200 |

### Confidence Metrics

| Metric | Value |
|--------|-------|
| Avg Confidence | 0.9749 |
| ACCEPT | 39 |
| REVIEW | 0 |
| REJECT | 6 |
| Accept Rate | 0.8667 |

### Latency Metrics

| Metric | Value |
|--------|-------|
| Avg Self-Check | 26,887 ms |
| Avg Total | 26,887 ms |
| p50 | 26,093 ms |
| p95 | 43,883 ms |
| p99 | 54,373 ms |

### Constraint Metrics

| Metric | Value |
|--------|-------|
| Avg Errors | 0.1111 |
| Avg Warnings | 0.5556 |
| Perfect Constraint Rate | 0.5556 |

## Observations

1. **`correct` category** performs well — high precision and recall (0.92).
2. **`boundary` and `hard` categories** show room for improvement (~0.70-0.76 recall).
3. **Accept rate (86.7%)** is reasonable; the 6 REJECT decisions are cases where the model found no entities but gold annotations had them.
4. **Avg confidence is high (0.97)** across all accepted items — the self-check verification is effective.
5. **Latency is significant** (~27s per example on average) due to two Ollama API calls per example (extraction + verification) on `phi4:14b`.

## Issues Encountered

- **Pipeline timeout:** Initial attempt with a 600-second timeout was insufficient (timed out at example 22/45). The pipeline was run in the background (`nohup`) to complete all 45 examples successfully. Total runtime: ~20 minutes.
- **No other errors:** Ollama was stable throughout; no API errors or malformed responses.

## Next Steps

- Improve performance on `boundary` and `hard` categories (target: recall > 0.80)
- Optimize latency (consider lighter model or parallel requests)
- Add more `hard` examples to the testset
